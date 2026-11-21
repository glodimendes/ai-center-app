import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { AccountProfile, Action, AgentDef, AgentsState, CliInfo, Limits } from '@shared/agents'
import { isoDate } from '@shared/time'
import { ApprovalStore, parseActions } from './agents/actions'
import { AgentError, ID_RE } from './agents/definition'
import { needsReview } from './agents/permissions'
import { ENGINES, profileEnv, resolveBinary, runEngine } from './agents/engines'
import { DEFAULT_PROFILES } from './agents/profiles'
import { budgetPause, readCodexLimits, readRunRows, usageTotals } from './agents/usage'
import { AgentRegistry } from './agents/registry'
import { runAgentDef } from './agents/runner'
import { Supervisor, type Execute } from './agents/supervisor'
import type { ContextSession } from './context/session'

const exec = promisify(execFile)
const DEFAULT_CEILING = 70

/** The planner's built-in AI paths, listed beside custom agents. Their behaviour stays in code (fixed safety); they are not files. */
const BUILTINS: AgentDef[] = [
  { id: 'daily-brief', name: 'Daily brief', profile: 'claude', permission: 'read', output: 'file', sources: [], triggers: ['on-open'], builtin: true, description: 'Reads the vault, today’s calendar and Gmail; writes 05_Tasks/briefs/YYYY-MM-DD.md. Edit its prompt in Settings.', instructions: '' },
  { id: 'update-context', name: 'Update context', profile: 'codex', permission: 'propose', output: 'reply', sources: [], triggers: ['manual'], builtin: true, description: 'Edits the vault from a sentence (⌘U); you review the diff and Keep or Undo.', instructions: '' },
  { id: 'planner-assistant', name: 'Planner assistant', profile: 'claude', permission: 'read', output: 'suggestions', sources: [], triggers: ['manual'], builtin: true, description: 'Suggest estimates (Tasks) and Plan with a wish (Re-plan). No tools; you approve every result.', instructions: '' }
]

export interface HubDeps {
  vaultRoot: () => string
  /** Folder for definitions; default `<vault>/06_Prompts/agents`. */
  agentsDir: () => string
  userData: string
  /** Account profiles from settings; unset = the defaults. */
  profiles: () => AccountProfile[] | undefined
  saveProfiles: (p: AccountProfile[]) => void
  context: ContextSession
  addTask: (section: string[], body: string) => Promise<void>
  completeTask: (taskId: string) => Promise<void>
  runBuiltin: (id: string) => Promise<void>
  push: () => void
}

/** Glue between the agent core and the app: runs agents, holds their results, executes approved actions. */
export class AgentHub {
  readonly registry: AgentRegistry
  readonly approvals: ApprovalStore
  readonly supervisor: Supervisor
  /** The run whose edits are waiting in ContextSession for Keep/Undo. */
  private reviewRunId: string | null = null
  private limits = new Map<string, Limits | null>()
  private cache: { at: number; totals: AgentsState['totals'] } | null = null
  private codexSeen = new Map<string, number>()
  private cli: CliInfo[] = []
  private limitsFile: string

  constructor(private deps: HubDeps) {
    this.limitsFile = join(deps.userData, 'limits.json')
    try {
      if (existsSync(this.limitsFile)) for (const [k, v] of Object.entries(JSON.parse(readFileSync(this.limitsFile, 'utf8')))) this.limits.set(k, v as Limits)
    } catch {
      /* limits are re-read from the CLIs */
    }
    this.registry = new AgentRegistry(deps.agentsDir)
    this.approvals = new ApprovalStore(
      join(deps.userData, 'approvals.json'),
      {
        'add-task': async (a) => {
          const { section, body } = a.payload as { section?: unknown; body?: unknown }
          if (!Array.isArray(section) || !section.every((x) => typeof x === 'string') || typeof body !== 'string' || !body.trim()) throw new Error('The proposal has no section or task text.')
          await deps.addTask(section as string[], body.trim())
        },
        'complete-task': async (a) => {
          if (typeof a.payload.taskId !== 'string') throw new Error('The proposal names no task.')
          await deps.completeTask(a.payload.taskId)
        }
      },
      deps.push
    )
    this.supervisor = new Supervisor(this.execute, join(deps.userData, 'runs'), deps.push, this.gate)
    void this.detectCli()
  }

  state(): AgentsState {
    const { agents, errors } = this.registry.list()
    const pending = this.deps.context.pendingResult
    return {
      agents: [...BUILTINS, ...agents],
      errors,
      runs: this.supervisor.list(),
      approvals: this.approvals.list(),
      profiles: this.profiles(),
      limits: this.currentLimits(),
      totals: this.totals(),
      cli: this.cli,
      dir: this.deps.agentsDir(),
      review: this.reviewRunId && pending ? { runId: this.reviewRunId, ...pending } : null
    }
  }

  profiles(): AccountProfile[] {
    return this.deps.profiles() ?? DEFAULT_PROFILES
  }

  /** Codex's numbers come from its own session logs (re-read at most every 30 s); Claude's arrive with each run or a Test. */
  private currentLimits(): Record<string, Limits | null> {
    const out: Record<string, Limits | null> = {}
    for (const p of this.profiles()) {
      if (p.engine === 'codex' && Date.now() - (this.codexSeen.get(p.id) ?? 0) > 30_000) {
        this.codexSeen.set(p.id, Date.now())
        try {
          const l = readCodexLimits(p.configDir ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'))
          if (l) this.limits.set(p.id, l)
        } catch {
          /* unreadable logs: show nothing rather than guess */
        }
      }
      out[p.id] = this.limits.get(p.id) ?? null
    }
    return out
  }

  private totals(): AgentsState['totals'] {
    if (this.cache && Date.now() - this.cache.at < 30_000) return this.cache.totals
    const totals = usageTotals(readRunRows(join(this.deps.userData, 'runs'), Date.now() - 7 * 86_400_000))
    this.cache = { at: Date.now(), totals }
    return totals
  }

  private setLimits(profileId: string, l: Omit<Limits, 'asOf'>) {
    if (!l.fiveHour && !l.weekly) return
    this.limits.set(profileId, { ...l, asOf: new Date().toISOString() })
    try {
      writeFileSync(this.limitsFile, JSON.stringify(Object.fromEntries(this.limits)))
    } catch {
      /* kept in memory */
    }
  }

  /** Budget check before each run: above the ceiling the run pauses and the user decides. Unknown usage never blocks. */
  private gate = (run: { profile: string; agentId: string }, def: AgentDef): string | null => {
    const profile = this.profiles().find((p) => p.id === def.profile)
    if (!profile) return null
    this.currentLimits()
    return budgetPause(this.limits.get(profile.id), def.budget ?? profile.sharePct ?? DEFAULT_CEILING, profile.label)
  }

  /** Lets a paused run start once; `raise` also lifts that account's ceiling by 20 points (max 100). */
  allowRun(runId: string, raise: boolean) {
    const run = this.supervisor.get(runId)
    if (raise && run) {
      const list = this.profiles().map((p) => (p.id === run.profile ? { ...p, sharePct: Math.min(100, (p.sharePct ?? DEFAULT_CEILING) + 20) } : p))
      this.deps.saveProfiles(list)
    }
    this.supervisor.allow(runId)
  }

  saveProfiles(list: AccountProfile[]) {
    const ids = new Set<string>()
    for (const p of list) {
      if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(p.id) || ids.has(p.id)) throw new AgentError(`"${p.id}" is empty, invalid or used twice (lowercase letters, digits, dashes).`)
      if (p.engine !== 'claude' && p.engine !== 'codex') throw new AgentError(`Unknown engine for "${p.id}".`)
      if (p.sharePct !== undefined && !(p.sharePct > 0 && p.sharePct <= 100)) throw new AgentError(`The ceiling of "${p.id}" is a percent between 1 and 100.`)
      ids.add(p.id)
    }
    for (const need of ['claude', 'codex']) if (!ids.has(need)) throw new AgentError(`The "${need}" profile is used by the built-in agents and can't be removed.`)
    this.deps.saveProfiles(list)
    this.deps.push()
  }

  private async detectCli() {
    const out: CliInfo[] = []
    for (const engine of ['claude', 'codex'] as const) {
      try {
        const path = await resolveBinary(engine)
        const { stdout } = await exec(path, ['--version'])
        out.push({ engine, path, version: stdout.trim().split('\n')[0] })
      } catch (e) {
        out.push({ engine, error: (e as Error).message })
      }
    }
    this.cli = out
    this.deps.push()
  }

  /** Checks the CLI answers for this profile's login and refreshes its window usage. Claude costs one tiny cheapest-model call. */
  async testProfile(id: string): Promise<{ ok: boolean; message: string }> {
    const profile = this.profiles().find((p) => p.id === id)
    if (!profile) return { ok: false, message: 'No such profile.' }
    await this.detectCli()
    try {
      if (profile.engine === 'codex') {
        const l = readCodexLimits(profile.configDir ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'))
        if (l) this.limits.set(id, l)
        return { ok: true, message: l ? 'Codex found. Window usage read from its session logs.' : 'Codex found, but its logs show no usage yet.' }
      }
      let seen = false
      const run = await runEngine(ENGINES[profile.engine], {
        profile,
        mode: 'read',
        prompt: 'Reply with the single word: ok',
        cwd: tmpdir(),
        timeoutMs: 60_000,
        onEvent: (ev) => {
          if (ev.type === 'limits') ((seen = true), this.setLimits(id, ev.limits))
        }
      })
      const r = await run.done
      if (r.isError || (r.code !== 0 && !r.text)) return { ok: false, message: r.text || r.stderr.trim().split('\n').slice(-2).join(' ') || 'The CLI failed. Is this account logged in?' }
      return { ok: true, message: seen ? 'Logged in. Window usage updated.' : 'Logged in, but the CLI reported no window usage for this plan.' }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    } finally {
      this.deps.push()
    }
  }

  async run(id: string, input: string): Promise<string> {
    const builtin = BUILTINS.find((b) => b.id === id)
    if (builtin) {
      if (id === 'daily-brief') {
        await this.deps.runBuiltin(id)
        return ''
      }
      throw new Error(`"${builtin.name}" runs from its own place in the app (${id === 'update-context' ? '⌘U' : 'Tasks and Re-plan'}).`)
    }
    const def = this.registry.get(id)
    if (!def) throw new Error('That agent no longer exists.')
    return this.supervisor.enqueue(def, input).id
  }

  save(def: AgentDef) {
    if (def.builtin || BUILTINS.some((b) => b.id === def.id)) throw new AgentError('Built-in agents can\'t be changed here.')
    this.registry.save({ ...def, builtin: undefined })
    this.deps.push()
  }

  remove(id: string) {
    if (BUILTINS.some((b) => b.id === id)) throw new AgentError('Built-in agents can\'t be deleted.')
    if (!ID_RE.test(id)) throw new AgentError('Invalid agent id.')
    this.registry.remove(id)
    this.deps.push()
  }

  async approve(id: string): Promise<Action> {
    return this.approvals.approve(id)
  }
  reject(id: string) {
    this.approvals.reject(id)
  }
  cancel(runId: string) {
    this.supervisor.cancel(runId)
  }
  /** After Keep/Undo of the shared review, the run no longer has one. */
  reviewResolved() {
    this.reviewRunId = null
  }
  async dispose() {
    this.supervisor.cancelAll()
  }

  private execute: Execute = async (run, def, onProgress, sig) => {
    const root = this.deps.vaultRoot()
    const date = isoDate(new Date())
    const go = (onCancel: (c: () => void) => void) => runAgentDef(def, run.input.text, { vaultRoot: root, profiles: this.profiles(), date, onProgress, onCancel, onLimits: (l) => this.setLimits(def.profile, l) })
    let text: string
    let usage: Awaited<ReturnType<typeof go>>['usage']
    if (needsReview(def)) {
      // Files it may edit are snapshotted and diffed; nothing stays without Keep.
      sig.cancel(() => this.deps.context.cancel())
      const res = await this.deps.context.update(run.input.text, async () => {
        let cancel = () => {}
        const p = go((c) => (cancel = c))
        return { done: p.then((r) => ((usage = r.usage), r.text)), cancel: () => cancel() }
      })
      text = res.summary
      if (res.changes.length) this.reviewRunId = run.id
    } else {
      const r = await go(sig.cancel)
      text = r.text
      usage = r.usage
    }
    if (def.output === 'actions' || def.output === 'suggestions') {
      const parsed = parseActions(text)
      text = parsed.text
      for (const a of parsed.actions) await this.approvals.propose(run.id, def.id, def.permission, a)
    }
    if (def.output === 'file' && text) {
      // The app writes the answer itself: an agent never needs write access for its own output.
      const rel = join('05_Tasks/agent-output', def.id, `${date}-${run.id}.md`)
      mkdirSync(dirname(join(root, rel)), { recursive: true })
      writeFileSync(join(root, rel), `# ${def.name} · ${date}\n\n${text}\n`)
      run.outputFile = rel
      onProgress(`Wrote ${rel}`)
    }
    this.cache = null
    return { text, usage }
  }
}
