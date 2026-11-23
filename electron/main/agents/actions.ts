import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { canAutoRun } from './permissions'
import type { Action, ActionKind, ChatQuestion, Permission } from '@shared/agents'

export type { Action, ActionKind }
export const ACTION_KINDS: ActionKind[] = ['remember', 'update-instructions', 'schedule', 'add-task', 'complete-task', 'create-event', 'email-draft', 'api-call', 'run-agent', 'new-agent']

export type Executor = (action: Action) => Promise<void>

/** Pulls the ```actions [...] ``` block an agent ends with. Unknown kinds and malformed entries are dropped. */
export function parseActions(text: string): { text: string; actions: { kind: ActionKind; title: string; payload: Record<string, unknown> }[] } {
  const m = text.match(/```actions\s*([\s\S]*?)```/)
  if (!m) return { text, actions: [] }
  // A label like "Proposed action:" left hanging just before the block belongs to the block, not to the answer.
  const rest = text.replace(m[0], '').trim().replace(/\n[^\n]{0,80}:\s*$/, '').trim()
  try {
    const arr = JSON.parse(m[1])
    const actions = (Array.isArray(arr) ? arr : [])
      .filter((a) => a && ACTION_KINDS.includes(a.kind) && typeof a.title === 'string' && a.title.trim())
      .map((a) => ({ kind: a.kind as ActionKind, title: String(a.title).trim(), payload: a.payload && typeof a.payload === 'object' ? a.payload : {} }))
    return { text: rest, actions }
  } catch {
    return { text: rest, actions: [] }
  }
}

/** Pulls the ```questions [...] ``` block a chat answer may end with (shown as a form). Malformed questions are dropped. */
export function parseQuestions(text: string): { text: string; questions: ChatQuestion[] } {
  const m = text.match(/```questions\s*([\s\S]*?)```/)
  if (!m) return { text, questions: [] }
  const rest = text.replace(m[0], '').trim()
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  try {
    const arr = JSON.parse(m[1])
    const questions = (Array.isArray(arr) ? arr : [])
      .filter((q) => q && str(q.question) && Array.isArray(q.options))
      .map((q): ChatQuestion => ({
        question: str(q.question),
        header: str(q.header) || undefined,
        options: (q.options as unknown[])
          .map((o) => (typeof o === 'string' ? { label: o.trim() } : o && typeof o === 'object' ? { label: str((o as any).label), description: str((o as any).description) || undefined } : { label: '' }))
          .filter((o) => o.label)
          .slice(0, 6),
        multiSelect: q.multiSelect === true || undefined
      }))
      .slice(0, 4)
    return { text: rest, questions }
  } catch {
    return { text: rest, questions: [] }
  }
}

/**
 * The Approvals inbox. `approve` is the only way an executor runs, apart from adding a task for an `act` agent.
 * A kind without an executor fails visibly instead of silently doing nothing.
 */
export class ApprovalStore {
  private items: Action[] = []
  private seq = 0

  constructor(
    private file: string | null,
    private executors: Partial<Record<ActionKind, Executor>>,
    private onChange: () => void = () => {}
  ) {
    if (file && existsSync(file)) {
      try {
        this.items = JSON.parse(readFileSync(file, 'utf8'))
      } catch {
        this.items = []
      }
    }
  }

  list(): Action[] {
    return this.items
  }

  pending(): Action[] {
    return this.items.filter((a) => a.status === 'pending')
  }

  async propose(runId: string, agentId: string, permission: Permission, a: { kind: ActionKind; title: string; payload: Record<string, unknown> }): Promise<Action> {
    const action: Action = { id: `${Date.now().toString(36)}-${++this.seq}`, runId, agentId, ...a, status: 'pending', createdAt: new Date().toISOString() }
    this.items.push(action)
    this.save()
    if (canAutoRun(a.kind, permission)) await this.execute(action)
    else this.onChange()
    return action
  }

  async approve(id: string): Promise<Action> {
    const action = this.items.find((a) => a.id === id)
    if (!action) throw new Error('That action no longer exists.')
    if (action.status !== 'pending') return action
    await this.execute(action)
    return action
  }

  reject(id: string) {
    const action = this.items.find((a) => a.id === id)
    if (!action || action.status !== 'pending') return
    action.status = 'rejected'
    action.resolvedAt = new Date().toISOString()
    this.save()
    this.onChange()
  }

  /** Takes back an action that ran on its own (a kept note): `undo` reverses its effect, the action reads as rejected. */
  async undo(id: string, undo: (a: Action) => void | Promise<void>) {
    const action = this.items.find((a) => a.id === id)
    if (!action || action.status !== 'done' || action.kind !== 'remember') return
    await undo(action)
    action.status = 'rejected'
    action.resolvedAt = new Date().toISOString()
    this.save()
    this.onChange()
  }

  private async execute(action: Action) {
    const run = this.executors[action.kind]
    try {
      if (!run) throw new Error(`"${action.kind}" actions can't be executed yet.`)
      await run(action)
      action.status = 'done'
    } catch (e) {
      action.status = 'failed'
      action.error = (e as Error).message
    }
    action.resolvedAt = new Date().toISOString()
    this.save()
    this.onChange()
  }

  private save() {
    // Keep the inbox bounded: resolved items older than the newest 200.
    const resolved = this.items.filter((a) => a.status !== 'pending')
    if (resolved.length > 200) this.items = this.items.filter((a) => a.status === 'pending' || resolved.slice(-200).includes(a))
    if (this.file) writeFileSync(this.file, JSON.stringify(this.items, null, 1))
  }
}
