// Types shared by the agent core (electron/main/agents) and the renderer.

export type EngineId = 'claude' | 'codex' | 'agy' | 'ollama' | 'command'

/** One login of one CLI. `configDir` is that CLI's home (CLAUDE_CONFIG_DIR / CODEX_HOME); unset = the CLI's default account. */
export interface AccountProfile {
  id: string
  engine: EngineId
  label: string
  configDir?: string
  /** Default model for agents on this profile (agents may set their own). Required for ollama. */
  model?: string
  /** ollama: server address (default http://127.0.0.1:11434). */
  baseUrl?: string
  /** ollama: how long the model stays loaded after a run: `0` unloads at once (default), or e.g. `5m`. */
  keepAlive?: string
  /** command: the program and its arguments; `{prompt}` is replaced by the prompt (else it is appended). Text in, text out. */
  command?: string[]
  /** Agents don't start while this account's 5-hour or weekly window is at or above this percent (default 70); they pause and ask. */
  sharePct?: number
}

export interface Usage {
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
}

/** One usage window of an account (the CLIs' 5-hour and weekly windows), as a percent used. Estimates read from the CLIs' own reports. */
export interface LimitWindow {
  usedPct: number
  /** ISO time the window resets. */
  resetsAt: string
}
export interface Limits {
  fiveHour?: LimitWindow
  weekly?: LimitWindow
  /** When we last saw this report. */
  asOf: string
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

export type RunStatus = 'queued' | 'paused' | 'running' | 'done' | 'error' | 'cancelled'

export interface Run {
  id: string
  agentId: string
  agentName: string
  /** Account profile the run used. */
  profile: string
  /** Set while status is `paused`: why the run waits for the user (budget). */
  pauseReason?: string
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
  /** True when this run is one turn of the agent's chat. */
  chat?: boolean
  /** Vault file the app wrote from the answer (output: file). */
  outputFile?: string
}

/** Everything with an effect outside the agent's own output: only ever proposed, then run when the user approves. */
export type ActionKind = 'add-task' | 'complete-task' | 'create-event' | 'email-draft' | 'api-call' | 'run-agent' | 'new-agent'

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

/** A place an agent may read from, defined once in Settings and referenced by id in an agent's `sources`. */
export interface SourceDef {
  id: string
  kind: 'vault-path' | 'file' | 'url' | 'gmail'
  label: string
  /** vault-path: relative to the vault; file: absolute or ~; a folder is read as its newest text files. */
  path?: string
  url?: string
  /** gmail: search query (default newer_than:3d) and how many messages (default 25, max 50). */
  query?: string
  max?: number
}

export interface UsageTotal {
  agentId: string
  profile: string
  runs: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface CliInfo {
  engine: EngineId
  path?: string
  version?: string
  error?: string
}

export interface SampleInfo {
  id: string
  name: string
  description: string
  needs?: string
  added: boolean
}

export interface ChatMessage {
  role: 'user' | 'agent'
  /** Who wrote an agent message (central chat shows several agents in one thread). */
  agentId?: string
  text: string
  t: string
  /** The run that produced it (agent messages). */
  runId?: string
}

export interface GoalDelegation {
  agent: string
  message: string
  runId?: string
  status: 'queued' | 'done' | 'error'
  result?: string
}

/** One goal a coordinator agent works on by delegating to other agents. */
export interface Goal {
  id: string
  text: string
  coordinator: string
  status: 'running' | 'done' | 'stopped' | 'needs-input' | 'error'
  /** Why it stopped or needs you (a limit, a loop, an error). */
  reason?: string
  createdAt: string
  turns: number
  delegations: number
  steps: { turn: number; coordinatorRunId: string; delegations: GoalDelegation[] }[]
  finalText?: string
  /** Earlier conversation the coordinator should know about (central chat); not shown as the goal's title. */
  context?: string
  /** Where it was started from (`central` = the central chat). */
  origin?: string
  /** Vault folder with the plan, each agent's output and the result. */
  folder: string
  /** Delegations already made (loop detection). */
  seen: string[]
}

export interface AgentsState {
  agents: AgentDef[]
  errors: { id: string; message: string }[]
  runs: Run[]
  approvals: Action[]
  profiles: AccountProfile[]
  /** Latest 5-hour and weekly window per profile id; null = not seen yet. */
  limits: Record<string, Limits | null>
  /** Agent runs per agent and profile, today and over the last 7 days. */
  totals: { today: UsageTotal[]; week: UsageTotal[] }
  cli: CliInfo[]
  sources: SourceDef[]
  gmail: { configured: boolean; connected: boolean }
  samples: SampleInfo[]
  /** Chat transcripts per agent id (the last 100 messages each). */
  chats: Record<string, ChatMessage[]>
  goals: Goal[]
  /** Folder the definitions are read from. */
  dir: string
  /** The unreviewed edits of a propose/act run, shown with Keep/Undo. */
  review: { runId: string; instruction: string; summary: string; changes: { path: string; before: string | null; after: string }[] } | null
}
