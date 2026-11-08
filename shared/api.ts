import type {
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
  VaultState
} from './types'

export interface AppState {
  vault: VaultState
  calendar: CalendarStatus
  events: CalEvent[]
  plan: Plan
  settings: Settings
}

/** Everything the renderer can ask the main process to do. */
export interface Api {
  getState(): Promise<AppState>
  // tasks
  patchTask(taskId: string, patch: TaskPatch): Promise<void>
  addTask(section: string[], body: string): Promise<void>
  deleteTask(taskId: string): Promise<void>
  // inbox
  addInbox(text: string): Promise<void>
  inboxToTask(itemId: string, text: string, section: string[]): Promise<void>
  removeInbox(itemId: string): Promise<void>
  // plan
  pin(pin: Pin): Promise<void>
  unpin(blockId: string): Promise<void>
  logBlock(entry: LogEntry, pin?: Pin): Promise<void>
  unlog(blockId: string, start: string): Promise<void>
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
  syncPreview(): Promise<{ ops: SyncOp[]; problems: string[] }>
  syncApply(ops: SyncOp[]): Promise<{ done: number; failed: string[] }>
  closeCapture(): Promise<void>
  // context updates (agent edits the vault; user keeps or undoes)
  contextUpdate(instruction: string): Promise<ContextResult>
  contextCancel(): Promise<void>
  contextKeep(): Promise<void>
  contextUndo(): Promise<void>
}

export type ApiMethod = keyof Api
