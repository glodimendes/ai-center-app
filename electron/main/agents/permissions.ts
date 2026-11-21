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

/** Actions with an outside effect never run on their own, whatever the permission. Only adding a task does, and only for `act`. */
export function canAutoRun(kind: ActionKind, permission: Permission): boolean {
  return permission === 'act' && kind === 'add-task'
}

/** Any run that may write files is reviewed: even `act` never edits vault files unreviewed (its own output file is written by the app). */
export const needsReview = (a: Pick<AgentDef, 'permission'>) => a.permission !== 'read'
