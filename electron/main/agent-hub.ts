import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import type { AccountProfile, Action, ChatMessage, Goal, HandoffPacket, SourceDef, AgentDef, AgentsState, CliInfo, Limits } from '@shared/agents'
import { isoDate } from '@shared/time'
import { AGENT_OUTPUT_DIR, BRIEFS_DIR, HANDOFFS_DIR } from '@shared/paths'
import { ApprovalStore, parseActions } from './agents/actions'
import { AgentError, ID_RE } from './agents/definition'
import { needsReview } from './agents/permissions'
import { ENGINES, failureMessage, ollamaModels, profileEnv, resolveBinary, runEngine } from './agents/engines'
import { DEFAULT_PROFILES } from './agents/profiles'
import { availableModels } from './agents/engines/models'
import type { GmailLike } from './agents/gmail'
import { buildRawDraft } from './agents/gmail'
import { GoalRunner } from './agents/goals'
import { SAMPLES } from './agents/samples'
import { buildSourceBundle } from './agents/sources'
import { parseMentions, routeCapture, withHistory } from './agents/capture'
import { dueAgents, watchMatches, type TickEvent } from './agents/triggers'
import { budgetPause, readCodexLimits, readRunRows, usageTotals } from './agents/usage'
import { AgentRegistry } from './agents/registry'
import { MAX_HOPS, SPILL_CHARS, handoffFormat, renderPacket, runAgentDef } from './agents/runner'
import { repeatKey } from './agents/goals'
import { Supervisor, type Execute } from './agents/supervisor'
import type { ContextSession } from './context/session'

const exec = promisify(execFile)
/** Key of the central chat's transcript. */
const CENTRAL = '_central'
const DEFAULT_CEILING = 70
/** Most conversation turns that may wait behind one agent. */
const MAX_PENDING = 5

/** The planner's built-in AI paths, listed beside custom agents. Their behaviour stays in code (fixed safety); they are not files. */
const BUILTINS: AgentDef[] = [
  { id: 'daily-brief', name: 'Daily brief', profile: 'claude', permission: 'read', output: 'file', sources: [], triggers: ['on-open'], builtin: true, description: `Reads the vault, today’s calendar and Gmail; writes ${BRIEFS_DIR}/YYYY-MM-DD.md. Edit its prompt in Settings.`, instructions: '' },
  { id: 'update-context', name: 'Update context', profile: 'codex', permission: 'propose', output: 'reply', sources: [], triggers: ['manual'], builtin: true, description: 'Edits the vault from a sentence (⌘U); you review the diff and Keep or Undo.', instructions: '' },
  { id: 'planner-assistant', name: 'Planner assistant', profile: 'claude', permission: 'read', output: 'suggestions', sources: [], triggers: ['manual'], builtin: true, description: 'Suggest estimates (Tasks) and Plan with a wish (Re-plan). No tools; you approve every result.', instructions: '' }
]

export interface HubDeps {
  vaultRoot: () => string
  /** Folder for definitions; default `<vault>/AGENTS_DIR`. */
  agentsDir: () => string
  userData: string
  /** Triggers spend model calls on their own, so they run only in the packaged app (or with AI_CENTER_TRIGGERS=1). */
  triggersEnabled: () => boolean
  /** Account profiles from settings; unset = the defaults. */
  profiles: () => AccountProfile[] | undefined
  saveProfiles: (p: AccountProfile[]) => void
  sources: () => SourceDef[] | undefined
  gmail: { configured: () => boolean; connected: () => boolean; api: () => Promise<GmailLike> }
  saveSources: (s: SourceDef[]) => void
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
  private triggersFile: string
  private chatDir: string
  private goalDir: string
  private goals: GoalRunner
  /** Per agent: the CLI conversation id and the transcript. Persisted under app data `chats/`. */
  private chats = new Map<string, { sessionId?: string; messages: ChatMessage[] }>()
  /** Per handoff chain: what was already asked of whom, so a chain can't repeat itself. */
  private chainSeen = new Map<string, Set<string>>()
  /** When each agent was last started (by a trigger or by hand), ms. Persisted so a restart doesn't re-fire a schedule. */
  private lastFired: Record<string, number> = {}

  constructor(private deps: HubDeps) {
    this.limitsFile = join(deps.userData, 'limits.json')
    try {
      if (existsSync(this.limitsFile)) for (const [k, v] of Object.entries(JSON.parse(readFileSync(this.limitsFile, 'utf8')))) this.limits.set(k, v as Limits)
    } catch {
      /* limits are re-read from the CLIs */
    }
    this.chatDir = join(deps.userData, 'chats')
    this.triggersFile = join(deps.userData, 'triggers.json')
    try {
      if (existsSync(this.triggersFile)) this.lastFired = JSON.parse(readFileSync(this.triggersFile, 'utf8'))
    } catch {
      /* worst case a schedule catches up once more */
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
        // Handing work to another agent: still one click, and that run is bound by its own permission and review.
        'run-agent': async (a) => {
          const { agent, input, objective, expect } = a.payload as { agent?: unknown; input?: unknown; objective?: unknown; expect?: unknown }
          const def = typeof agent === 'string' ? this.registry.get(agent) : undefined
          if (!def) throw new Error(`There is no agent "${String(agent)}". Add it first.`)
          const text = typeof input === 'string' ? input : ''
          const from = this.supervisor.get(a.runId)
          const by = this.registry.get(a.agentId)?.name ?? a.agentId
          const hops = (from?.hops ?? 0) + 1
          const chainId = from?.chainId ?? a.runId
          if (hops > MAX_HOPS) throw new Error(`Handoff chain limit reached (${MAX_HOPS}). Continue by hand if this is still needed.`)
          const key = repeatKey({ agent: def.id, message: text || a.title })
          const seen = this.chainSeen.get(chainId) ?? new Set<string>()
          if (seen.has(key)) throw new Error(`${def.name} was already asked the same thing in this chain.`)
          seen.add(key)
          this.chainSeen.set(chainId, seen)
          const packet = this.makePacket(def, by, a, { objective, input: text, expect }, chainId)
          const conversation = from && (from.chat || from.input.from === 'central')
          if (conversation) packet.origin = from.chat ? from.agentId : CENTRAL
          const msg = renderPacket(packet, by)
          // Proposed from a conversation: the work continues in the target's own chat, and the origin thread gets a pointer.
          if (conversation) this.sendChat(def.id, msg, packet.origin, { packet, parentRunId: a.runId, chainId, hops })
          else this.supervisor.enqueue(def, msg, { from: a.agentId, parentRunId: a.runId, packet, chainId, hops })
        },
        // A new definition file is the app's own output; its permission can't exceed `propose` this way.
        'new-agent': async (a) => {
          const p = a.payload as Record<string, unknown>
          const text = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : undefined)
          const id = text('id') ?? ''
          if (this.registry.get(id)) throw new Error(`An agent "${id}" already exists.`)
          const permission = p.permission === 'propose' ? 'propose' : 'read'
          const output = ['reply', 'file', 'suggestions', 'actions'].includes(String(p.output)) ? (p.output as AgentDef['output']) : 'reply'
          const triggers = Array.isArray(p.triggers) && p.triggers.every((t) => typeof t === 'string') ? (p.triggers as string[]) : ['manual']
          this.registry.save({ id, name: text('name') ?? id, profile: text('profile') ?? 'claude', permission, output, triggers, sources: [], instructions: text('instructions') ?? '', description: text('description') })
        },
        // Only ever a draft in the user's Gmail drafts folder; sending is the user's own step in Gmail.
        'email-draft': async (a) => {
          const { to, subject, body } = a.payload as Record<string, unknown>
          if (typeof to !== 'string' || !to.includes('@') || typeof body !== 'string' || !body.trim()) throw new Error('The draft needs a recipient and a body.')
          await (await deps.gmail.api()).createDraft(buildRawDraft({ to, subject: typeof subject === 'string' ? subject : '', body }))
        },
        'complete-task': async (a) => {
          if (typeof a.payload.taskId !== 'string') throw new Error('The proposal names no task.')
          await deps.completeTask(a.payload.taskId)
        }
      },
      deps.push
    )
    this.supervisor = new Supervisor(this.execute, join(deps.userData, 'runs'), deps.push, this.gate, join(deps.userData, 'queue.json'))
    this.goalDir = join(deps.userData, 'goals')
    let restored: Goal[] = []
    try {
      restored = existsSync(this.goalDir) ? readdirSync(this.goalDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(this.goalDir, f), 'utf8'))) : []
    } catch {
      restored = []
    }
    this.goals = new GoalRunner(
      {
        agents: () => this.registry.list().agents,
        enqueue: (def, text, opts) => this.supervisor.enqueue(def, text, opts),
        wait: (id) => this.supervisor.wait(id),
        cancel: (id) => this.supervisor.cancel(id),
        // The goal's shared workspace is an app-owned folder in the vault, readable by the user and by agents.
        write: (rel, text) => {
          const abs = join(deps.vaultRoot(), rel)
          mkdirSync(dirname(abs), { recursive: true })
          writeFileSync(abs, text)
        },
        save: (g) => {
          mkdirSync(this.goalDir, { recursive: true })
          writeFileSync(join(this.goalDir, `${g.id}.json`), JSON.stringify(g))
        },
        onChange: deps.push,
        onFinish: (g) => this.goalFinished(g)
      },
      restored
    )
    // What was waiting when the app last closed goes back in the queue.
    this.supervisor.restore((id) => this.registry.get(id))
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
      sources: this.deps.sources() ?? [],
      gmail: { configured: this.deps.gmail.configured(), connected: this.deps.gmail.connected() },
      goals: this.goals.list().slice(-20),
      // Transcripts are loaded from disk on first use, so a conversation survives a restart.
      chats: Object.fromEntries([CENTRAL, ...agents.filter((a) => !a.builtin).map((a) => a.id)].map((id) => [id, this.chat(id).messages.slice(-100)])),
      samples: SAMPLES.map((x) => ({ id: x.def.id, name: x.def.name, description: x.def.description ?? '', needs: x.needs, added: agents.some((a) => a.id === x.def.id) })),
      dir: this.deps.agentsDir(),
      review: this.reviewRunId && pending ? { runId: this.reviewRunId, ...pending } : null
    }
  }

  private markFired(id: string) {
    this.lastFired[id] = Date.now()
    try {
      writeFileSync(this.triggersFile, JSON.stringify(this.lastFired))
    } catch {
      /* kept in memory */
    }
  }

  private busy(agentId: string) {
    return this.supervisor.list().some((r) => r.agentId === agentId && ['queued', 'paused', 'running'].includes(r.status))
  }

  /** Starts agents whose schedule or on-open trigger is due. An agent with a run already waiting or going is skipped, so triggers never pile up. */
  fire(event: TickEvent, now = new Date()): string[] {
    if (!this.deps.triggersEnabled()) return []
    const defs = this.registry.list().agents
    const started: string[] = []
    for (const id of dueAgents(defs, this.lastFired, now, event)) {
      const def = defs.find((d) => d.id === id)!
      if (this.busy(id)) continue
      this.markFired(id)
      this.supervisor.enqueue(def, event === 'open' ? 'Started because the app was opened.' : 'Started by its schedule.', { from: 'trigger' })
      started.push(id)
    }
    return started
  }

  /** A markdown file changed outside the app: runs agents watching it, at most once per 30 s each. Their own outputs never count. */
  fileChanged(relPath: string) {
    if (!this.deps.triggersEnabled()) return
    const agentsRel = relative(this.deps.vaultRoot(), this.deps.agentsDir())
    const ignore = (p: string) => p.startsWith(`${AGENT_OUTPUT_DIR}/`) || p.startsWith(`${agentsRel}/`) || p.startsWith(`${BRIEFS_DIR}/`)
    const defs = this.registry.list().agents
    for (const id of watchMatches(defs, relPath, ignore)) {
      if (this.busy(id) || Date.now() - (this.lastFired[id] ?? 0) < 30_000) continue
      this.markFired(id)
      this.supervisor.enqueue(defs.find((d) => d.id === id)!, `File changed: ${relPath}`, { from: 'trigger' })
    }
  }

  /** ⌘⇧Space text: `@agent message` starts that agent; everything else is an inbox line (the caller adds it). */
  routeCapture(text: string): { kind: 'inbox' } | { kind: 'agent'; agent: string } {
    const route = routeCapture(text, this.registry.list().agents)
    if (route.kind === 'inbox') return { kind: 'inbox' }
    if (route.kind === 'unknown') {
      const names = this.registry.list().agents.map((a) => `@${a.id}`)
      throw new Error(`No agent called "${route.name}".${names.length ? ` Agents: ${names.join(', ')}.` : ' There are no custom agents yet.'}`)
    }
    this.markFired(route.agent.id)
    this.supervisor.enqueue(route.agent, route.message, { from: 'capture' })
    return { kind: 'agent', agent: route.agent.name }
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

  private chat(agentId: string) {
    let c = this.chats.get(agentId)
    if (!c) {
      const file = join(this.chatDir, `${agentId}.json`)
      try {
        c = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined
      } catch {
        c = undefined
      }
      this.chats.set(agentId, (c ??= { messages: [] }))
    }
    return c
  }

  private saveChat(agentId: string) {
    try {
      mkdirSync(this.chatDir, { recursive: true })
      writeFileSync(join(this.chatDir, `${agentId}.json`), JSON.stringify(this.chat(agentId)))
    } catch {
      /* the transcript stays in memory */
    }
  }

  /** One chat turn: a run that continues the agent's conversation. It queues, passes the budget gate and, for propose/act agents, is reviewed like any run. */
  sendChat(agentId: string, text: string, origin?: string, extra: { packet?: HandoffPacket; parentRunId?: string; chainId?: string; hops?: number } = {}): string {
    const def = this.registry.get(agentId)
    if (!def) throw new AgentError('That agent no longer exists.')
    if (!text.trim()) throw new AgentError('Write a message first.')
    const engine = this.profiles().find((p) => p.id === def.profile)?.engine
    if (!engine) throw new AgentError('This agent uses an account that no longer exists. Edit the agent and pick another.')
    // Busy is fine: the turn waits its turn in the queue (and survives a restart). Only a pile-up is refused.
    if (this.supervisor.pendingFor(agentId) >= MAX_PENDING) throw new AgentError(`${def.name} already has ${MAX_PENDING} messages waiting. Let it catch up first.`)
    this.chat(agentId)
    const id = this.supervisor.enqueue(def, text.trim(), { from: 'chat', chat: true, ...extra }).id
    // Handed over from another conversation: leave a pointer there, so the thread shows where the work went.
    if (origin && origin !== agentId && (origin === CENTRAL || this.registry.get(origin))) {
      this.chat(origin).messages.push({ role: 'note', text: `Sent to ${def.name}`, link: agentId, t: new Date().toISOString() })
      this.saveChat(origin)
      this.deps.push()
    }
    return id
  }

  startGoal(coordinatorId: string, text: string): string {
    const def = this.registry.get(coordinatorId)
    if (!def) throw new AgentError('That agent no longer exists.')
    return this.goals.start(def, text).id
  }
  stopGoal(id: string) {
    this.goals.stop(id)
  }
  resumeGoal(id: string) {
    this.goals.resume(id)
  }

  /**
   * The central chat. `@agent` tags send the message to those agents (each answers in the thread); a message with no tag
   * goes to a coordinator agent, which splits it between your other agents like a goal.
   */
  sendCentral(text: string): void {
    const agents = this.registry.list().agents
    const m = parseMentions(text, agents)
    if (m.unknown.length) throw new AgentError(`No agent called ${m.unknown.map((u) => `@${u}`).join(', ')}.`)
    const body = m.agents.length ? m.text : text.trim()
    if (!body) throw new AgentError('Write a message first.')
    const central = this.chat(CENTRAL)
    const t = new Date().toISOString()
    const history = central.messages.filter((m) => m.role !== 'note').slice(-8)
    central.messages.push({ role: 'user', text: text.trim(), t })
    this.saveChat(CENTRAL)
    if (m.agents.length) {
      for (const a of m.agents) {
        if (this.supervisor.pendingFor(a.id, false) >= MAX_PENDING) throw new AgentError(`${a.name} already has ${MAX_PENDING} things waiting. Let it catch up first.`)
        this.markFired(a.id)
        this.supervisor.enqueue(a, body, { from: 'central' })
      }
      return this.deps.push()
    }
    const coordinator = agents.find((a) => a.id === 'coordinator' && a.permission === 'read') ?? agents.find((a) => !a.builtin && a.permission === 'read' && /coordinator/i.test(a.name))
    if (!coordinator) {
      central.messages.pop()
      throw new AgentError('Untagged messages go to a coordinator agent, and there is none yet. Add the Coordinator from Agents → Examples, or tag an agent with @.')
    }
    const context = history.map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`).join('\n')
    this.goals.start(coordinator, body, 'central', context || undefined)
    this.deps.push()
  }

  private goalFinished(g: Goal) {
    if (g.origin !== 'central') return
    const text = g.status === 'done' ? (g.finalText ?? '') : `${g.status === 'needs-input' ? 'I paused: ' : 'I stopped: '}${g.reason ?? g.status}`
    this.chat(CENTRAL).messages.push({ role: 'agent', agentId: g.coordinator, text: text || '(no answer)', t: new Date().toISOString() })
    this.saveChat(CENTRAL)
    this.deps.push()
  }

  resetChat(agentId: string) {
    this.chats.set(agentId, { messages: [] })
    this.saveChat(agentId)
    this.deps.push()
  }

  addSample(id: string) {
    const sample = SAMPLES.find((x) => x.def.id === id)
    if (!sample) throw new AgentError('No such sample.')
    if (this.registry.get(id)) throw new AgentError(`"${sample.def.name}" is already added.`)
    this.registry.save(sample.def)
    this.deps.push()
  }

  saveSources(list: SourceDef[]) {
    const ids = new Set<string>()
    for (const s of list) {
      if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(s.id) || ids.has(s.id)) throw new AgentError(`"${s.id}" is empty, invalid or used twice (lowercase letters, digits, dashes).`)
      if (!['vault-path', 'file', 'url', 'gmail'].includes(s.kind)) throw new AgentError(`Unknown source kind for "${s.id}".`)
      ids.add(s.id)
    }
    this.deps.saveSources(list)
    this.deps.push()
  }

  /** Reads one source now, so the user sees what an agent would get. */
  async previewSource(id: string): Promise<string> {
    const def = (this.deps.sources() ?? []).find((s) => s.id === id)
    if (!def) throw new AgentError('No such source.')
    return (await buildSourceBundle([id], [def], this.deps.vaultRoot(), undefined, () => this.deps.gmail.api())).slice(0, 4000)
  }

  saveProfiles(list: AccountProfile[]) {
    const ids = new Set<string>()
    for (const p of list) {
      if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(p.id) || ids.has(p.id)) throw new AgentError(`"${p.id}" is empty, invalid or used twice (lowercase letters, digits, dashes).`)
      if (!(p.engine in ENGINES)) throw new AgentError(`Unknown engine for "${p.id}".`)
      if (p.engine === 'command' && p.command && p.command.some((x) => typeof x !== 'string')) throw new AgentError(`The command of "${p.id}" must be a list of text.`)
      if (p.sharePct !== undefined && !(p.sharePct > 0 && p.sharePct <= 100)) throw new AgentError(`The ceiling of "${p.id}" is a percent between 1 and 100.`)
      ids.add(p.id)
    }
    for (const need of ['claude', 'codex']) if (!ids.has(need)) throw new AgentError(`The "${need}" profile is used by the built-in agents and can't be removed.`)
    this.deps.saveProfiles(list)
    this.deps.push()
  }

  /** The CLIs behind the profiles (claude and codex always: the built-ins use them). Ollama is checked by asking its server. */
  private async detectCli() {
    const out: CliInfo[] = []
    const engines = new Set<AccountProfile['engine']>(['claude', 'codex', ...this.profiles().map((p) => p.engine)])
    for (const engine of engines) {
      if (engine === 'command') continue
      try {
        if (engine === 'ollama') {
          const url = this.profiles().find((p) => p.engine === 'ollama')?.baseUrl
          const models = await ollamaModels(url)
          out.push({ engine, version: `${models.length} model${models.length === 1 ? '' : 's'}: ${models.slice(0, 4).join(', ')}` })
          continue
        }
        const path = await resolveBinary(engine)
        const { stdout } = await exec(path, ['--version'])
        out.push({ engine, path, version: stdout.trim().split('\n')[0] })
      } catch (e) {
        const msg = (e as Error).message
        out.push({ engine, error: engine === 'ollama' && /fetch failed|ECONNREFUSED|aborted/i.test(msg) ? 'not running (start Ollama to use local models)' : msg })
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
        mode: profile.engine === 'claude' ? 'read' : 'ask',
        prompt: 'Reply with the single word: ok',
        cwd: tmpdir(),
        timeoutMs: 60_000,
        onEvent: (ev) => {
          if (ev.type === 'limits') ((seen = true), this.setLimits(id, ev.limits))
        }
      })
      const r = await run.done
      if (r.isError || (r.code !== 0 && !r.text)) return { ok: false, message: r.text || failureMessage(r.stderr, r.code, profile.engine) }
      if (profile.engine !== 'claude') return { ok: true, message: `Works. It answered: ${r.text.slice(0, 60)}` }
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
    this.markFired(id)
    return this.supervisor.enqueue(def, input).id
  }

  /** The packet for a handoff. A long input is kept in an app-owned vault file and handed over as a path plus a short head. */
  private makePacket(def: AgentDef, fromName: string, a: Action, p: { objective: unknown; input: string; expect: unknown }, chainId: string): HandoffPacket {
    const packet: HandoffPacket = { from: a.agentId, objective: typeof p.objective === 'string' && p.objective.trim() ? p.objective.trim() : a.title, input: p.input, expect: typeof p.expect === 'string' && p.expect.trim() ? p.expect.trim() : undefined }
    if (p.input.length > SPILL_CHARS) {
      const dir = join(HANDOFFS_DIR, chainId)
      const abs = join(this.deps.vaultRoot(), dir)
      const reachable = !def.workdir || join(dir).startsWith(def.workdir.replace(/\/$/, '') + '/')
      if (reachable) {
        mkdirSync(abs, { recursive: true })
        const n = readdirSync(abs).length + 1
        const rel = join(dir, `${String(n).padStart(2, '0')}-${a.agentId}-to-${def.id}.md`)
        writeFileSync(join(this.deps.vaultRoot(), rel), `# Handed over by ${fromName} to ${def.name}\n\n${p.input}\n`)
        packet.context = [rel]
        packet.input = `${p.input.slice(0, 400)}… (the full text is in ${rel})`
      }
    }
    return packet
  }

  /** Models the account can run (empty: the engine picks its own, so no choice is offered). */
  models(profileId: string): Promise<string[]> {
    const profile = this.profiles().find((p) => p.id === profileId)
    return profile ? availableModels(profile).catch(() => []) : Promise.resolve([])
  }

  async save(def: AgentDef) {
    if (def.builtin || BUILTINS.some((b) => b.id === def.id)) throw new AgentError('Built-in agents can\'t be changed here.')
    if (def.model) {
      const models = await this.models(def.profile)
      // An engine with no list of its own (or an unreachable Ollama) can't be checked, so only a known list refuses.
      if (models.length && !models.includes(def.model)) throw new AgentError(`"${def.model}" is not available on this account. Pick one from the list.`)
    }
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
    for (const g of this.goals.list()) this.goals.stop(g.id, 'The app was closed.')
    this.supervisor.shutdown()
  }

  private execute: Execute = async (run, def, onProgress, sig) => {
    const root = this.deps.vaultRoot()
    const date = isoDate(new Date())
    const sources = await buildSourceBundle(def.sources, this.deps.sources() ?? [], root, undefined, () => this.deps.gmail.api())
    const chat = run.chat ? this.chat(def.id) : undefined
    // First turn: Claude takes a session id we choose; Codex reports its own (kept after the run). Later turns resume it.
    const engine = this.profiles().find((p) => p.id === def.profile)?.engine
    // Engines that can't keep a conversation (Ollama, a custom command) get the transcript as text instead.
    const sessionless = Boolean(chat && engine && !ENGINES[engine].chat)
    const input = chat && sessionless ? withHistory(chat.messages, run.input.text) : run.input.text
    const session = chat && !sessionless ? (chat.sessionId ? { id: chat.sessionId, resume: true } : { id: engine === 'claude' ? randomUUID() : '', resume: false }) : undefined
    let sessionId: string | undefined
    // Conversation runs may propose handing work on (run-agent, add-task) when there is anyone to hand it to.
    const conversation = Boolean(run.chat || run.input.from === 'central')
    const peers = this.registry.list().agents.filter((x) => x.id !== def.id)
    const handoff = conversation && peers.length && (run.hops ?? 0) < MAX_HOPS ? handoffFormat(peers) : undefined
    const go = (onCancel: (c: () => void) => void) => runAgentDef(def, input, { handoff, session, vaultRoot: root, profiles: this.profiles(), date, onProgress, onCancel, sources, onLimits: (l) => this.setLimits(def.profile, l) })
    let text: string
    let usage: Awaited<ReturnType<typeof go>>['usage']
    if (needsReview(def)) {
      // Files it may edit are snapshotted and diffed; nothing stays without Keep.
      sig.cancel(() => this.deps.context.cancel())
      const res = await this.deps.context.update(run.input.text, async () => {
        let cancel = () => {}
        const p = go((c) => (cancel = c))
        return { done: p.then((r) => ((usage = r.usage), (sessionId = r.sessionId), r.text)), cancel: () => cancel() }
      })
      text = res.summary
      if (res.changes.length) this.reviewRunId = run.id
    } else {
      const r = await go(sig.cancel)
      text = r.text
      usage = r.usage
      sessionId = r.sessionId
    }
    if (def.output === 'actions' || def.output === 'suggestions' || handoff) {
      const parsed = parseActions(text)
      text = parsed.text
      // Agents that didn't ask for actions may only propose handing work on or adding a task.
      const wide = def.output === 'actions' || def.output === 'suggestions'
      for (const a of parsed.actions) if (wide || a.kind === 'run-agent' || a.kind === 'add-task') await this.approvals.propose(run.id, def.id, def.permission, a)
    }
    if (def.output === 'file' && text) {
      // The app writes the answer itself: an agent never needs write access for its own output.
      const rel = join(AGENT_OUTPUT_DIR, def.id, `${date}-${run.id}.md`)
      mkdirSync(dirname(join(root, rel)), { recursive: true })
      writeFileSync(join(root, rel), `# ${def.name} · ${date}\n\n${text}\n`)
      run.outputFile = rel
      onProgress(`Wrote ${rel}`)
    }
    if (chat) {
      // The turn counts only once it succeeded; a failed one leaves the conversation as it was.
      if (sessionId) chat.sessionId = sessionId
      const t = new Date().toISOString()
      chat.messages.push({ role: 'user', text: run.input.text, t }, { role: 'agent', text, t, runId: run.id })
      this.saveChat(def.id)
    }
    if (run.input.from === 'central') {
      // Tagged in the central chat: the answer lands in that thread under the agent's name.
      const central = this.chat(CENTRAL)
      central.messages.push({ role: 'agent', agentId: def.id, text: text || '(no text)', t: new Date().toISOString(), runId: run.id })
      this.saveChat(CENTRAL)
    }
    // Handed over from a conversation: tell that thread the answer is ready (it lives in this agent's own chat).
    const origin = run.input.packet?.origin
    if (origin && origin !== def.id && (origin === CENTRAL || this.registry.get(origin))) {
      this.chat(origin).messages.push({ role: 'note', text: `${def.name} answered`, link: def.id, t: new Date().toISOString() })
      this.saveChat(origin)
    }
    this.cache = null
    return { text, usage }
  }
}
