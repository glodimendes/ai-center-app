import type {
  Block,
  BriefData,
  CalEvent,
  ContextResult,
  CalendarStatus,
  DocContent,
  DocInfo,
  LogEntry,
  Pin,
  Plan,
  Preferences,
  Settings,
  SyncOp,
  TaskPatch,
  VaultState,
  Weekday
} from './types'

export interface EstimateSuggestion {
  taskId: string
  title: string
  section: string[]
  category: string
  minutes: number
  why: string
}

/** "Plan with a wish": a sentence turned into concrete, checkable changes for the next two weeks. */
export interface Wish {
  summary: string
  strategy?: PlanVariant
  /** Keep areas (empty = all work) out of part of a date, or cap them that date. */
  limits: { date: string; areas: string[]; maxMinutes: number; from?: string; to?: string }[]
  /** Hours set aside for an area on a date (replaces the grid cell for that weekday, that week only). */
  hours: { date: string; area: string; hours: number }[]
  /** Time on a date kept for one heading's tasks (e.g. a project): becomes a pinned block holding only them. */
  focus: { date: string; from: string; to: string; heading: string }[]
}

export type PlanVariant = 'balanced' | 'deadlines' | 'deep' | 'light'

export interface PlanMetrics {
  workHours: number
  deepHours: number
  /** Deadline warnings (overdue, at risk, losing slack). */
  atRisk: number
  unscheduled: number
  /** Work after 19:00. */
  eveningHours: number
  /** Task segments across blocks: each one is a switch. */
  switches: number
  /** Working hours with nothing in them. */
  freeHours: number
}

export interface PlanOption {
  key: PlanVariant
  label: string
  desc: string
  seed?: number
  plan: Plan
  metrics: PlanMetrics
}

export interface AppState {
  vault: VaultState
  calendar: CalendarStatus
  events: CalEvent[]
  plan: Plan
  /** Strategy of the current plan (Re-plan options); stays until another one is applied. */
  planVariant: { key: PlanVariant; label: string; seed?: number }
  settings: Settings
  brief: { running: boolean; error?: string }
  /** Open tasks that appeared in the todo file from outside the app (an automation, Codex, Obsidian) and aren't reviewed yet. */
  newTaskIds: string[]
}

/** Everything the renderer can ask the main process to do. */
export interface Api {
  getState(): Promise<AppState>
  // tasks
  patchTask(taskId: string, patch: TaskPatch): Promise<void>
  addTask(section: string[], body: string): Promise<void>
  deleteTask(taskId: string): Promise<void>
  /** 'in': becomes a subtask of the task above it; 'out': back to its parent's level. Subtasks move along. */
  indentTask(taskId: string, dir: 'in' | 'out'): Promise<void>
  addSubtask(parentId: string, body: string): Promise<void>
  /** Move a task to sit right before/after another task at the same level (same parent, same section). */
  reorderTask(taskId: string, targetId: string, position: 'before' | 'after'): Promise<void>
  /** Check off now; outside a running block it's also logged as a short block ending now. */
  completeTask(taskId: string): Promise<void>
  /** Skip one occurrence of a repeating task: its due date moves on, the series stays. Returns the new due date. */
  skipOccurrence(taskId: string): Promise<string>
  // inbox
  addInbox(text: string): Promise<void>
  inboxToTask(itemId: string, text: string, section: string[]): Promise<void>
  removeInbox(itemId: string): Promise<void>
  // plan
  replan(): Promise<void>
  /** A preview of a full re-plan under one strategy (seed = Shuffle). Nothing changes until applyPlanOption. */
  planOption(key: PlanVariant, seed?: number): Promise<PlanOption>
  applyPlanOption(key: PlanVariant, seed?: number): Promise<void>
  pin(pin: Pin): Promise<void>
  unpin(blockId: string): Promise<void>
  logBlock(entry: LogEntry, pin?: Pin): Promise<void>
  unlog(blockId: string, start: string): Promise<void>
  // brief
  getBrief(date: string): Promise<BriefData>
  generateBrief(): Promise<void>
  /** Brief prompt: the user's editable instructions (vault 06_Prompts/daily-brief.md) + the fixed output format. */
  getBriefPrompt(): Promise<{ custom: string | null; defaultText: string; format: string }>
  saveBriefPrompt(text: string | null): Promise<void>
  // calendar display & availability
  setCalendarVisible(calendarName: string, visible: boolean): Promise<void>
  setCalendarBusy(calendarName: string, busy: boolean): Promise<void>
  setEventAvailability(eventKey: string, value: 'busy' | 'free' | null): Promise<void>
  /** The user's own hand edit of one of their events (one occurrence). Never planner, protected or read-only calendars. */
  /** Returns the event's id afterwards (it can change when a macOS event moves). */
  editEvent(calendarId: string, eventId: string, change: { title?: string; start?: string; end?: string }): Promise<string>
  deleteEvent(calendarId: string, eventId: string): Promise<void>
  // block editing
  addTaskToBlock(blockId: string, taskId: string): Promise<void>
  removeTaskFromBlock(blockId: string, taskId: string): Promise<void>
  removeBlock(blockId: string): Promise<void>
  /** Postpone all open tasks in a block until a date (null: stop postponing them). */
  postponeBlock(blockId: string, until: string | null): Promise<void>
  /** Undo a removal: un-dismiss and, for a block that was pinned, pin it again. */
  restoreBlock(block: Block): Promise<void>
  /** Let the planner use time that was held empty after a removal. */
  releaseHold(start: string, end: string): Promise<void>
  /** "One day per week" day rule: this week's day; null lets the planner pick. */
  setDayPick(week: string, ruleId: string, day: string | null): Promise<void>
  /** This week's own hours per area per weekday; null goes back to the Settings grid. */
  setWeekGrid(week: string, grid: Record<string, Partial<Record<Weekday, number>>> | null): Promise<void>
  setWeekNotes(week: string, notes: string): Promise<void>
  /** Weekly review: moves checked tasks to 05_Tasks/archive/done-YYYY.md. Returns how many moved. */
  archiveDone(): Promise<number>
  /** Claude Haiku suggests ~estimates for open tasks without one (no tools; nothing is written). */
  suggestEstimates(): Promise<EstimateSuggestion[]>
  /** Writes the estimates the user accepted. */
  applyEstimates(minutesById: Record<string, number>): Promise<void>
  /** Marks tasks added outside the app as reviewed. */
  acknowledgeTasks(ids: string[]): Promise<void>
  /** Claude Haiku turns a sentence into a Wish; previewed as a plan, nothing is saved. */
  planWish(text: string): Promise<{ wish: Wish; changes: string[]; option: PlanOption }>
  /** Saves a previewed wish into the weeks it touches and re-plans. */
  applyWish(wish: Wish): Promise<void>
  /** Removes a date rule (e.g. from a wish) from a week. */
  removeWeekRule(week: string, ruleId: string): Promise<void>
  // docs
  listDocs(): Promise<DocInfo[]>
  readDoc(path: string): Promise<DocContent>
  writeDoc(path: string, content: string, baseHash: string): Promise<DocContent>
  // preferences & settings
  savePreferences(prefs: Preferences): Promise<void>
  saveSettings(settings: Partial<Settings>): Promise<void>
  chooseVault(): Promise<string | null>
  revealVault(path?: string): Promise<void>
  // calendar
  connectCalendar(): Promise<void>
  disconnectCalendar(): Promise<void>
  refreshCalendar(): Promise<void>
  /** With `day` (YYYY-MM-DD) the diff covers that one day only; otherwise the whole syncDays window. */
  syncPreview(day?: string): Promise<{ ops: SyncOp[]; problems: string[] }>
  syncApply(ops: SyncOp[]): Promise<{ done: number; failed: string[] }>
  closeCapture(): Promise<void>
  // context updates (agent edits the vault; user keeps or undoes)
  contextUpdate(instruction: string): Promise<ContextResult>
  contextCancel(): Promise<void>
  contextKeep(): Promise<void>
  /** Returns files left untouched because they changed since in a way that can't be safely separated. */
  contextUndo(): Promise<string[]>
}

export type ApiMethod = keyof Api

/** The renderer may call these and nothing else on the controller. Typed so it can't drift from Api. */
export const API_METHODS: Record<ApiMethod, true> = {
  getState: true, patchTask: true, addTask: true, deleteTask: true, indentTask: true, addSubtask: true, reorderTask: true,
  completeTask: true, skipOccurrence: true, addInbox: true, inboxToTask: true, removeInbox: true, replan: true, planOption: true,
  applyPlanOption: true, pin: true, unpin: true, logBlock: true, unlog: true, getBrief: true, generateBrief: true, getBriefPrompt: true,
  saveBriefPrompt: true, setCalendarVisible: true, setCalendarBusy: true, setEventAvailability: true, editEvent: true, deleteEvent: true,
  addTaskToBlock: true, removeTaskFromBlock: true, removeBlock: true, postponeBlock: true, restoreBlock: true, releaseHold: true,
  listDocs: true, readDoc: true, writeDoc: true, savePreferences: true, saveSettings: true, chooseVault: true, revealVault: true,
  connectCalendar: true, disconnectCalendar: true, refreshCalendar: true, syncPreview: true, syncApply: true, closeCapture: true,
  contextUpdate: true, contextCancel: true, contextKeep: true, contextUndo: true,
  setDayPick: true, setWeekGrid: true, setWeekNotes: true, archiveDone: true, suggestEstimates: true, applyEstimates: true, acknowledgeTasks: true, planWish: true, applyWish: true, removeWeekRule: true
}
