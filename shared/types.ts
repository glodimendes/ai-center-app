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
  parentId?: string
  childIds: string[]
}

export interface TaskPatch {
  title?: string
  estimateMin?: number | null
  due?: string | null
  priority?: Priority
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
  window?: [string, string]
  budget?: { minHours?: number; maxHours?: number }
  color: string
}

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export interface Preferences {
  workingHours: Record<Weekday, [string, string] | null>
  slotMinutes: number
  minChunkMinutes: number
  bufferMinutes: number
  maxDeepWorkMinutesPerDay: number
  horizonDays: number
  syncDays: number
  ignoreCalendars: string[]
  categories: CategoryPref[]
  training: {
    category: string
    cycleStart: string
    preferredWindows: [string, string][]
  }
}

export interface TrainingSession {
  day: number
  session: string
  focus: string
  minutes: number
  rest?: boolean
}

export interface TrainingPlan {
  days: TrainingSession[]
  /** Day 7 rotation, index 0 = week 1. */
  day7Rotation: { label: string; minutes: number; rest: boolean }[]
}

export interface CalendarInfo {
  id: string
  name: string
  color: string
  writable: boolean
  primary?: boolean
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
}

export interface TaskChunk {
  taskId: string
  minutes: number
}

export type BlockKind = 'container' | 'proposed' | 'training' | 'pinned' | 'topup'

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
  trainingSession?: string
  pinned?: boolean
}

export interface PlanWarning {
  kind: 'deadline' | 'overload' | 'budget-behind' | 'budget-over' | 'unscheduled'
  message: string
  taskId?: string
  category?: string
}

export interface Plan {
  generatedAt: string
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
}

export interface WeekData {
  week: string
  log: LogEntry[]
  pins: Pin[]
}

export interface VaultState {
  vaultPath: string
  tasks: Task[]
  sections: Section[]
  inbox: InboxItem[]
  preferences: Preferences
  preferencesFileExists: boolean
  training: TrainingPlan | null
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
  connected: boolean
  configured: boolean
  calendars: CalendarInfo[]
  lastRefresh?: string
  error?: string
}
