export type Priority = 'high' | 'medium' | 'low'

export interface Task {
  /** Stable across line shifts: derived from file, heading path, title and occurrence. */
  id: string
  file: string
  line: number
  indent: number
  /** Title without metadata tokens (may contain inline markdown). */
  title: string
  done: boolean
  section: string[]
  category: string
  estimateMin?: number
  due?: string
  /** Original deadline style so edits keep the user's phrasing. */
  dueStyle?: 'iso' | 'by-slash' | 'by-dot'
  priority: Priority
  /** Per-task timing override (`@spread` / `@asap` on the line); otherwise the category default. */
  timing?: Timing
  /** Repeat rule (`repeat:` token, see shared/repeat.ts): checking it off adds the next occurrence. */
  repeat?: string
  /** Postponed (`postpone:` token): not planned before this date. */
  postponed?: string
  parentId?: string
  childIds: string[]
}

export type Timing = 'asap' | 'spread'

export interface TaskPatch {
  title?: string
  estimateMin?: number | null
  due?: string | null
  priority?: Priority
  timing?: Timing | null
  repeat?: string | null
  postponed?: string | null
  done?: boolean
}

export interface Section {
  path: string[]
  category: string
  taskIds: string[]
}

export interface InboxItem {
  id: string
  line: number
  text: string
  date?: string
  topic?: string
}

export interface DocInfo {
  path: string
  title: string
  group: string
}

export interface DocContent {
  path: string
  content: string
  hash: string
}

export interface CategoryPref {
  key: string
  label: string
  /** Case-insensitive substrings matched against todo headings (deepest heading wins). */
  headings: string[]
  /** Google calendar name (summary) blocks of this category are written to. */
  calendar: string
  /** Event titles in that calendar treated as containers for this category. */
  containers: string[]
  defaultEstimateMinutes: number
  deepWork?: boolean
  /** Hard window: the category is never planned outside it. */
  window?: [string, string]
  /** Soft windows, tried first each day in this order (e.g. thesis in the morning, then late afternoon). */
  preferredWindows?: [string, string][]
  /** Older single soft window; read once and folded into `preferredWindows`. */
  preferredWindow?: [string, string]
  /** New blocks are at least this long, so small tasks batch together. */
  minBlockMinutes?: number
  budget?: { minHours?: number; maxHours?: number }
  /** Importance multiplier in the weighted score (1 = neutral). */
  weight?: number
  /** Default timing for this area's tasks. */
  timing?: Timing
  /** Never split a task: each one goes into a single block (e.g. a training session). */
  wholeTasks?: boolean
  /** Reserve this area's unfilled daily grid hours as blocks (deep-work time even without tasks). */
  reserveQuota?: boolean
  color: string
}

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export interface BreakPref {
  label: string
  /** The break floats inside this window to the first free stretch. */
  window: [string, string]
  minutes: number
}

export interface StrategyPref {
  /** Weighted score = (deadlineWeight × urgency + priorityWeight × priority) × area weight. */
  deadlineWeight: number
  priorityWeight: number
  /** Tasks due within this many days go first regardless of score (and may exceed grid hours). */
  deadlineGuardDays: number
  /** Spread tasks without a deadline are spread over this many working days. */
  spreadDays: number
}

export interface Preferences {
  workingHours: Record<Weekday, [string, string] | null>
  slotMinutes: number
  minChunkMinutes: number
  bufferMinutes: number
  maxDeepWorkMinutesPerDay: number
  /** Cap on planned work per day (training and breaks don't count). */
  dailyMaxMinutes: { weekday: number; weekend: number }
  /** One task gets at most this much per day, so big tasks spread out. */
  maxTaskMinutesPerDay: number
  maxBlockMinutes: number
  /** Gap kept after deep-work blocks and around training. */
  deepWorkBufferMinutes: number
  trainingBufferMinutes: number
  /** Aim to finish deadline tasks this many days early. */
  deadlineSlackDays: number
  /** Overdue longer than this = stale: planned after everything else and flagged for review. */
  staleOverdueDays: number
  /** A task checked off outside its planned block is logged as a block of this length ending now (0 = off). */
  completedTaskMinutes: number
  breaks: BreakPref[]
  strategy: StrategyPref
  /** Hours per area per weekday. When enabled, an area gets at most its hours that day. */
  allocation: { enabled: boolean; hours: Record<string, Partial<Record<Weekday, number>>> }
  horizonDays: number
  syncDays: number
  ignoreCalendars: string[]
  /** Never written to, even after a confirmed sync (prefix match, e.g. "ETH Classes"). Still count as busy. */
  protectedCalendars: string[]
  categories: CategoryPref[]
  /** The training area: a gap around its blocks, and it doesn't count toward the daily work cap. */
  training: {
    category: string
    /** Older files: windows of the removed training cycle, folded into the area's preferred windows. */
    preferredWindows?: [string, string][]
    cycleStart?: string
  }
}

export interface CalendarInfo {
  id: string
  name: string
  color: string
  writable: boolean
  primary?: boolean
  /** Account the calendar belongs to (macOS: e.g. "Google", "iCloud"). */
  source?: string
}

export interface CalEvent {
  id: string
  calendarId: string
  calendarName: string
  title: string
  start: string
  end: string
  allDay: boolean
  description?: string
  /** Set on events created by the planner. */
  plannerBlockId?: string
  /** Marked "free" (not busy) in the calendar itself (Google transparency / EventKit availability). */
  free?: boolean
}

export interface TaskChunk {
  taskId: string
  minutes: number
}

export type BlockKind = 'container' | 'proposed' | 'pinned' | 'topup' | 'break'

export interface Block {
  id: string
  kind: BlockKind
  category: string
  title: string
  start: string
  end: string
  calendarName: string
  chunks: TaskChunk[]
  /** Existing calendar event backing this block (containers). */
  eventId?: string
  pinned?: boolean
  /** User-drawn block the planner fills with its area's tasks (Pin.fill). */
  fill?: boolean
}

export interface PlanWarning {
  kind: 'deadline' | 'overload' | 'budget-behind' | 'budget-over' | 'unscheduled' | 'stale' | 'conflict'
  message: string
  /** The problem without the task title, for lists that show the task separately. */
  detail?: string
  /** Deadline warnings: already overdue, or at risk of missing it. */
  level?: 'overdue' | 'risk'
  taskId?: string
  category?: string
}

export interface Plan {
  generatedAt: string
  /** 'full' = everything re-planned; 'incremental' = existing blocks kept in place, only contents refreshed. */
  mode: 'full' | 'incremental'
  /** When the last full re-plan happened. */
  fullPlannedAt: string
  blocks: Block[]
  warnings: PlanWarning[]
  /** taskId -> end of its last scheduled chunk */
  taskFinish: Record<string, string>
}

export type LogStatus = 'done' | 'partial' | 'skipped'

export interface LogEntry {
  blockId: string
  date: string
  category: string
  title: string
  start: string
  plannedMin: number
  actualMin: number
  status: LogStatus
  note?: string
  taskIds?: string[]
}

export interface Pin {
  blockId: string
  category: string
  title: string
  start: string
  end: string
  taskIds: string[]
  /** A block the user drew: the planner also fills its free time with the area's tasks. */
  fill?: boolean
}

/** Manual planning decisions for a week (stored in the weekly file). */
export interface WeekOverrides {
  /** Planner blocks the user removed: not recreated under that id; containers listed here aren't filled. */
  dismissed?: string[]
  /** Tasks the user put into a block (container or planner block): placed there first. */
  assignments?: { blockId: string; taskIds: string[] }[]
  /** Task removed from a block: the planner won't put it in that block again. */
  exclusions?: { blockId: string; taskId: string }[]
  /** Time left empty after the user removed a block: the planner places nothing new there until Re-plan. */
  holds?: { start: string; end: string }[]
}

export interface WeekData {
  week: string
  log: LogEntry[]
  pins: Pin[]
  overrides?: WeekOverrides
}

export interface VaultState {
  vaultPath: string
  tasks: Task[]
  sections: Section[]
  inbox: InboxItem[]
  preferences: Preferences
  preferencesFileExists: boolean
  weeks: Record<string, WeekData>
  errors: string[]
}

export type ContextEngine = 'claude' | 'codex'

export interface ContextChange {
  path: string
  before: string | null
  after: string
}

export interface ContextResult {
  instruction: string
  summary: string
  changes: ContextChange[]
}

export interface Settings {
  vaultPath: string
  autoCommit: boolean
  contextEngine: ContextEngine
  calendarProvider: 'macos' | 'google'
  /** Generate the daily brief the first time the app opens each day. */
  briefAuto: boolean
  briefEmail: boolean
  /** Calendars hidden from Today/Week/Brief (display only). */
  hiddenCalendars: string[]
  /** Per-event "busy"/"free" overrides, keyed by `${calendarId}:${eventId}`. */
  eventAvailability: Record<string, 'busy' | 'free'>
  googleClientId?: string
  googleClientSecret?: string
}

export interface SyncOp {
  op: 'create' | 'update' | 'delete'
  calendarName: string
  blockId: string
  title: string
  start: string
  end: string
  eventId?: string
  calendarId?: string
  previous?: { start: string; end: string; title: string }
  description?: string
}

export interface CalendarStatus {
  provider: 'macos' | 'google'
  connected: boolean
  configured: boolean
  calendars: CalendarInfo[]
  lastRefresh?: string
  error?: string
}

export interface TaskNote {
  path: string
  title: string
  status?: string
  updated?: string
  next: string[]
}

export interface BriefData {
  date: string
  /** Brief written by the Codex daily-brief automation to 05_Tasks/briefs/<date>.md, split by "## " headings. */
  codex: { path: string; sections: { title: string; body: string }[] } | null
  notes: TaskNote[]
}
