import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Action, AgentDef, AgentsState } from '@shared/agents'
import { isoDate } from '@shared/time'
import { ApprovalStore, parseActions } from './agents/actions'
import { AgentError, ID_RE } from './agents/definition'
import { needsReview } from './agents/permissions'
import { DEFAULT_PROFILES } from './agents/profiles'
import { AgentRegistry } from './agents/registry'
import { runAgentDef } from './agents/runner'
import { Supervisor, type Execute } from './agents/supervisor'
import type { ContextSession } from './context/session'

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

  constructor(private deps: HubDeps) {
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
    this.supervisor = new Supervisor(this.execute, join(deps.userData, 'runs'), deps.push)
  }

  state(): AgentsState {
    const { agents, errors } = this.registry.list()
    const pending = this.deps.context.pendingResult
    return {
      agents: [...BUILTINS, ...agents],
      errors,
      runs: this.supervisor.list(),
      approvals: this.approvals.list(),
      profiles: DEFAULT_PROFILES,
      dir: this.deps.agentsDir(),
      review: this.reviewRunId && pending ? { runId: this.reviewRunId, ...pending } : null
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
    const go = (onCancel: (c: () => void) => void) => runAgentDef(def, run.input.text, { vaultRoot: root, profiles: DEFAULT_PROFILES, date, onProgress, onCancel })
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
    return { text, usage }
  }
}
