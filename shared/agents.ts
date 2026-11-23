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
  /** Input served from the provider's prompt cache (cheap) and written to it (dearer), when the CLI reports them. */
  cacheReadTokens?: number
  cacheWriteTokens?: number
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
  /** Folder the agent works in: relative to the vault or an absolute path. Unset = its own empty workspace; the vault is always readable too. */
  workdir?: string
  /** More folders the agent may use besides the main one (vault-relative or absolute). The vault itself is always added. */
  folders?: string[]
  /** Keeps notes between runs and chats (app data `memory/<id>.md`), shown and editable in the editor. */
  memory?: boolean
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

/** What one agent hands to another (A2A-style): enough for the receiver to work without the sender's conversation. */
export interface HandoffPacket {
  /** Id of the agent that handed it over. */
  from: string
  /** What the receiver should achieve. */
  objective: string
  /** The material to work on (may be a short head of a longer text kept in `context`). */
  input: string
  /** The form the answer should take. */
  expect?: string
  /** Vault files to read (e.g. the full text of a long input). */
  context?: string[]
  /** The conversation it came from (`_central` or an agent id), where the answer is announced. */
  origin?: string
}

/** Input and output of a run are messages, so agents can talk to each other. */
export interface AgentMessage {
  from: string
  to: string
  text: string
  attachments?: string[]
  /** Set when another agent handed this work over. */
  packet?: HandoffPacket
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
  /** The first run of the chain of handoffs this run belongs to (its own id when it starts one). */
  chainId?: string
  /** How many handoffs deep this run is (0 = not handed over). */
  hops?: number
  input: AgentMessage
  status: RunStatus
  queuedAt: string
  startedAt?: string
  endedAt?: string
  progress: string[]
  /** The answer so far while the run is working (not saved to the log). */
  partial?: string
  output?: AgentMessage
  error?: string
  usage?: Usage
  /** True when this run is one turn of the agent's chat. */
  chat?: boolean
  /** Vault file the app wrote from the answer (output: file). */
  outputFile?: string
}

/** Everything with an effect outside the agent's own output: only ever proposed, then run when the user approves. */
export type ActionKind = 'remember' | 'update-instructions' | 'schedule' | 'add-task' | 'complete-task' | 'create-event' | 'email-draft' | 'api-call' | 'run-agent' | 'new-agent'

/**
 * Scheduled AI work: at `time` on its days the app sends `prompt` to the agent's own chat, as if the user had typed it.
 * Proposed by the agent from its chat (action `schedule`), created only on the user's click; kept in app data `routines.json`.
 */
export interface Routine {
  id: string
  agentId: string
  title: string
  prompt: string
  /** HH:MM, local time. */
  time: string
  /** `daily`, `weekdays`, `weekends` or weekday names like `mon,thu`. */
  days: string
  paused?: boolean
  createdAt: string
  /** When it last started a turn (ISO). */
  lastRun?: string
}

/** A question the agent asks with choices (like Claude Code's question form); the chat shows it as a form, the reply is the next message. */
export interface ChatQuestion {
  question: string
  /** Short label for the answer line. */
  header?: string
  options: { label: string; description?: string }[]
  multiSelect?: boolean
}

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

/** What agents used on one day (the cost view's bars). */
export interface DayCost {
  /** Local date, yyyy-mm-dd. */
  day: string
  runs: number
  tokens: number
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
  /** `note` is a line the app adds (e.g. "Sent to Research"); it is never part of what an agent sees. */
  role: 'user' | 'agent' | 'note'
  /** Who wrote an agent message (central chat shows several agents in one thread). */
  agentId?: string
  text: string
  t: string
  /** The run that produced it (agent messages). */
  runId?: string
  /** note: the conversation it points to (an agent id). */
  link?: string
  /** user: absolute paths of the files attached to this message. */
  files?: string[]
  /** user: sent by a routine (its title), not typed. */
  routine?: string
  /** agent: questions it asked with choices, shown as a form until the user answers. */
  questions?: ChatQuestion[]
}

/** A conversation's own account, model and effort, chosen in the chat (the agent's own settings are the default). */
export interface ChatOverride {
  profile: string
  model?: string
  effort?: string
}

/** What the chat's model picker offers for one account. */
export interface ChatModelOption {
  profile: string
  label: string
  engine: EngineId
  models: string[]
  efforts: string[]
}

/** A file found for an `@` reference. */
export interface FileHit {
  path: string
  /** Path relative to the root it was found under. */
  rel: string
  /** Which folder it is in: the main folder, an extra one or the vault. */
  root: string
}

export interface GoalDelegation {
  agent: string
  message: string
  /** Set when another agent of the goal asked this one (a peer question), not the coordinator. */
  from?: string
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
  /** Counts at the last "Continue": the limits apply to what was used since, so a resumed goal gets a fresh budget. */
  turnsBase?: number
  delegationsBase?: number
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

/**
 * A file in the agents folder that wasn't created or accepted in the app (another tool may have written it).
 * It isn't an agent until the user imports it: it doesn't run, chat or receive handoffs.
 */
export interface FoundAgent {
  /** File name in the agents folder. */
  file: string
  /** The agent the app would import, when the file can be read. */
  def?: AgentDef
  /** What importing changes or leaves out (fields other tools use, a new file name). */
  notes: string[]
  /** Why it can't be imported. */
  error?: string
}

/** In-app organization of the agents, kept in app data (not in the agent files). */
export interface AgentOrganization {
  /** Group names in display order. */
  groups: string[]
  /** Agent id → its group. */
  group: Record<string, string>
  /** Agents shown in the Chat sidebar. */
  pinned: string[]
}

/** One change to the in-app organization (Agents view). */
export type OrganizeChange =
  | { kind: 'import'; file: string }
  | { kind: 'ignore'; file: string; ignore: boolean }
  | { kind: 'group'; id: string; group: string }
  | { kind: 'move-group'; group: string; dir: -1 | 1 }
  | { kind: 'pin'; id: string; pinned: boolean }

export interface AgentsState {
  agents: AgentDef[]
  /** Files in the agents folder waiting to be imported or ignored. */
  found: FoundAgent[]
  /** File names the user chose to ignore. */
  ignored: string[]
  organization: AgentOrganization
  errors: { id: string; message: string }[]
  runs: Run[]
  approvals: Action[]
  profiles: AccountProfile[]
  /** Latest 5-hour and weekly window per profile id; null = not seen yet. */
  limits: Record<string, Limits | null>
  /** Agent runs per agent and profile, today and over the last 7 days. */
  totals: { today: UsageTotal[]; week: UsageTotal[]; month: UsageTotal[] }
  /** The last 14 days, oldest first. */
  costDays: DayCost[]
  cli: CliInfo[]
  sources: SourceDef[]
  gmail: { configured: boolean; connected: boolean }
  samples: SampleInfo[]
  /** Chat transcripts per agent id (the last 100 messages each). */
  chats: Record<string, ChatMessage[]>
  /** Folder a conversation works in (set from the chat header); absent = the agent's own setting. */
  chatFolders: Record<string, string>
  /** Folders added to one conversation on top of the agent's own. */
  chatExtraFolders: Record<string, string[]>
  /** Account, model and effort a conversation switched to (absent = the agent's own). */
  chatModels: Record<string, ChatOverride>
  goals: Goal[]
  routines: Routine[]
  /** Folder the definitions are read from. */
  dir: string
  /** The unreviewed edits of a propose/act run, shown with Keep/Undo. */
  review: { runId: string; instruction: string; summary: string; changes: { path: string; before: string | null; after: string }[] } | null
}
