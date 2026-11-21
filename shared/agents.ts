// Types shared by the agent core (electron/main/agents) and the renderer.

export type EngineId = 'claude' | 'codex'

/** One login of one CLI. `configDir` is that CLI's home (CLAUDE_CONFIG_DIR / CODEX_HOME); unset = the CLI's default account. */
export interface AccountProfile {
  id: string
  engine: EngineId
  label: string
  configDir?: string
  /** Share of the account's usage window agents may use (Phase 2). */
  sharePct?: number
}

export interface Usage {
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
}

/** What an agent may do. `read` answers only; `propose` and `act` edit files for review (Keep/Undo); `act` also adds tasks without a click. Outside effects always need a click. */
export type Permission = 'read' | 'propose' | 'act'
export type AgentOutput = 'reply' | 'file' | 'suggestions' | 'actions'

export interface AgentDef {
  /** File name without .md. */
  id: string
  name: string
  /** Account profile id. */
  profile: string
  model?: string
  effort?: string
  permission: Permission
  /** Folder the agent works in, relative to the vault; default the vault root. */
  workdir?: string
  /** Data source ids from Settings (Phase 3). */
  sources: string[]
  /** Triggers as written, e.g. `manual`, `schedule: 07:00` (Phase 3 interprets them). */
  triggers: string[]
  output: AgentOutput
  /** Pause-and-ask ceiling in percent of the account's agent share (Phase 2). */
  budget?: number
  /** Built-in agents are code paths shown here; their file can't be edited. */
  builtin?: boolean
  description?: string
  instructions: string
}

/** Input and output of a run are messages, so agents can later talk to each other (Phase 7). */
export interface AgentMessage {
  from: string
  to: string
  text: string
  attachments?: string[]
}

export type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface Run {
  id: string
  agentId: string
  agentName: string
  parentRunId?: string
  input: AgentMessage
  status: RunStatus
  queuedAt: string
  startedAt?: string
  endedAt?: string
  progress: string[]
  output?: AgentMessage
  error?: string
  usage?: Usage
  /** Vault file the app wrote from the answer (output: file). */
  outputFile?: string
}

/** Everything with an effect outside the agent's own output: only ever proposed, then run when the user approves. */
export type ActionKind = 'add-task' | 'complete-task' | 'create-event' | 'email-draft' | 'api-call'

export interface Action {
  id: string
  runId: string
  agentId: string
  kind: ActionKind
  title: string
  payload: Record<string, unknown>
  status: 'pending' | 'done' | 'rejected' | 'failed'
  error?: string
  createdAt: string
  resolvedAt?: string
}

export interface AgentsState {
  agents: AgentDef[]
  errors: { id: string; message: string }[]
  runs: Run[]
  approvals: Action[]
  profiles: AccountProfile[]
  /** Folder the definitions are read from. */
  dir: string
  /** The unreviewed edits of a propose/act run, shown with Keep/Undo. */
  review: { runId: string; instruction: string; summary: string; changes: { path: string; before: string | null; after: string }[] } | null
}
