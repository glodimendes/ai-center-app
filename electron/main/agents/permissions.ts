import type { ActionKind, AgentDef, Permission } from '@shared/agents'
import type { RunMode } from './engines/types'

/**
 * Permission → what the engine is allowed to do. Enforced by CLI flags and sandboxes, never by the prompt.
 * `propose` and `act` both edit files inside the agent's folder, and either run's edits are held for Keep/Undo
 * (the caller snapshots and diffs); `act` differs only in which actions run without a click (see canAutoRun).
 */
export function engineMode(p: Permission): RunMode {
  return p === 'read' ? 'read' : 'edit'
}

/**
 * Actions with an outside effect never run on their own, whatever the permission. Two things do:
 * adding a task (only for `act`), and keeping a note in the agent's own memory file (any permission, user-approved
 * 2026-11-22: it never touches the vault, tasks or calendar, shows under the message with Undo, and only agents
 * with memory switched on may propose it). Changing an agent's own instructions always needs the click.
 */
export function canAutoRun(kind: ActionKind, permission: Permission): boolean {
  return kind === 'remember' || (permission === 'act' && kind === 'add-task')
}

/** Any run that may write files is reviewed: even `act` never edits vault files unreviewed (its own output file is written by the app). */
export const needsReview = (a: Pick<AgentDef, 'permission'>) => a.permission !== 'read'
