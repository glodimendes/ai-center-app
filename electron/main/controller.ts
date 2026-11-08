import { BrowserWindow, dialog, shell } from 'electron'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Api, AppState } from '@shared/api'
import type { CalEvent, CalendarStatus, ContextChange, ContextResult, Plan, Settings, SyncOp } from '@shared/types'
import { addDays, startOfDay, weekStart } from '@shared/time'
import { VaultService } from './vault/service'
import { GoogleCalendar } from './calendar/google'
import { buildSyncDiff } from './calendar/sync'
import { plan } from './scheduler/plan'
import { loadSettings, saveSettings } from './settings'
import { runContextAgent, snapshotVault, type AgentRun } from './context/agent'

/** Owns vault, calendar and the current plan; implements the renderer API. */
export class Controller implements Api {
  private settings: Settings = loadSettings()
  private vault!: VaultService
  private google = new GoogleCalendar(this.settings.googleClientId, this.settings.googleClientSecret)
  private calendar: CalendarStatus = { connected: false, configured: false, calendars: [] }
  private events: CalEvent[] = []
  private refreshTimer: NodeJS.Timeout | null = null
  private agent: AgentRun | null = null
  private pendingContext: ContextResult | null = null

  constructor(
    private broadcast: (state: AppState) => void,
    private emit: (channel: string, payload: unknown) => void
  ) {
    this.openVault()
    this.refreshTimer = setInterval(() => void this.refreshCalendar().catch(() => {}), 10 * 60_000)
  }

  private openVault() {
    void this.vault?.close()
    this.vault = new VaultService(this.settings.vaultPath, () => this.settings.autoCommit, () => this.push())
    this.vault.startWatching()
  }

  private currentPlan(): Plan {
    const v = this.vault.state()
    return plan({ tasks: v.tasks, events: this.events, prefs: v.preferences, training: v.training, weeks: v.weeks, now: new Date() })
  }

  async getState(): Promise<AppState> {
    const vault = this.vault.state()
    const p = plan({ tasks: vault.tasks, events: this.events, prefs: vault.preferences, training: vault.training, weeks: vault.weeks, now: new Date() })
    return {
      vault,
      plan: p,
      events: this.events,
      calendar: { ...this.calendar, connected: this.google.connected, configured: this.google.configured },
      settings: { ...this.settings, googleClientSecret: this.settings.googleClientSecret ? '••••••' : undefined }
    }
  }

  push() {
    void this.getState().then(this.broadcast, (err) => console.error('[state]', err))
  }

  private mutate<T>(fn: () => T): T {
    const out = fn()
    this.push()
    return out
  }

  private taskTitle(id: string) {
    return this.vault.state().tasks.find((t) => t.id === id)?.title ?? 'task'
  }

  // --- tasks & inbox -------------------------------------------------------
  async patchTask(taskId: string, patch: Parameters<Api['patchTask']>[1]) {
    const title = this.taskTitle(taskId)
    const what =
      patch.done === true ? 'complete' : patch.done === false ? 'reopen' : patch.title !== undefined ? 'rename' : 'update'
    this.mutate(() => this.vault.patchTask(taskId, patch, `${what} "${title}"`))
  }
  async addTask(section: string[], body: string) {
    this.mutate(() => this.vault.addTask(section, body))
  }
  async deleteTask(taskId: string) {
    const title = this.taskTitle(taskId)
    this.mutate(() => this.vault.deleteTask(taskId, title))
  }
  async addInbox(text: string) {
    this.mutate(() => this.vault.addInbox(text))
  }
  async inboxToTask(itemId: string, text: string, section: string[]) {
    this.mutate(() => this.vault.inboxToTask(itemId, text, section))
  }
  async removeInbox(itemId: string) {
    this.mutate(() => this.vault.removeInbox(itemId))
  }

  // --- plan ----------------------------------------------------------------
  async pin(p: Parameters<Api['pin']>[0]) {
    this.mutate(() => this.vault.pin(p))
  }
  async unpin(blockId: string) {
    this.mutate(() => this.vault.unpin(blockId))
  }
  async logBlock(entry: Parameters<Api['logBlock']>[0], p?: Parameters<Api['logBlock']>[1]) {
    this.mutate(() => this.vault.logBlock(entry, p))
  }
  async unlog(blockId: string, start: string) {
    this.mutate(() => this.vault.unlog(blockId, start))
  }

  // --- docs ----------------------------------------------------------------
  async listDocs() {
    return this.vault.listDocs()
  }
  async readDoc(path: string) {
    return this.vault.readDoc(path)
  }
  async writeDoc(path: string, content: string, baseHash: string) {
    return this.mutate(() => this.vault.writeDoc(path, content, baseHash))
  }

  // --- settings ------------------------------------------------------------
  async savePreferences(prefs: Parameters<Api['savePreferences']>[0]) {
    this.mutate(() => this.vault.savePreferences(prefs))
  }

  async saveSettings(patch: Partial<Settings>) {
    const next = { ...this.settings, ...patch }
    if (patch.googleClientSecret === '••••••') next.googleClientSecret = this.settings.googleClientSecret
    const vaultChanged = next.vaultPath !== this.settings.vaultPath
    const googleChanged = next.googleClientId !== this.settings.googleClientId || next.googleClientSecret !== this.settings.googleClientSecret
    this.settings = next
    saveSettings(next)
    if (vaultChanged) this.openVault()
    if (googleChanged && next.googleClientId && next.googleClientSecret) this.google.configure(next.googleClientId, next.googleClientSecret)
    this.push()
  }

  async chooseVault() {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: this.settings.vaultPath })
    return res.canceled ? null : res.filePaths[0]
  }

  async revealVault(path?: string) {
    if (path) shell.showItemInFolder(`${this.settings.vaultPath}/${path}`)
    else void shell.openPath(this.settings.vaultPath)
  }

  // --- calendar ------------------------------------------------------------
  async connectCalendar() {
    await this.google.connect()
    await this.refreshCalendar()
  }

  async disconnectCalendar() {
    this.google.disconnect()
    this.events = []
    this.calendar = { connected: false, configured: this.google.configured, calendars: [] }
    this.push()
  }

  async refreshCalendar() {
    if (!this.google.connected) return
    try {
      const calendars = await this.google.calendars()
      const prefs = this.vault.preferences
      const from = addDays(weekStart(new Date()), -7)
      const to = addDays(startOfDay(new Date()), prefs.horizonDays + 7)
      this.events = await this.google.events(calendars, from, to)
      this.calendar = { connected: true, configured: true, calendars, lastRefresh: new Date().toISOString() }
    } catch (err) {
      this.calendar = { ...this.calendar, error: String((err as Error).message ?? err) }
    }
    this.push()
  }

  async syncPreview() {
    await this.refreshCalendar()
    const v = this.vault.state()
    return buildSyncDiff(this.currentPlan().blocks, this.events, this.calendar.calendars, v.preferences, v.tasks, new Date())
  }

  async syncApply(ops: SyncOp[]) {
    const failed: string[] = []
    let done = 0
    for (const op of ops) {
      try {
        const ev = { title: op.title, start: op.start, end: op.end, description: op.description }
        if (op.op === 'create') await this.google.insert(op.calendarId!, op.blockId, ev)
        else if (op.op === 'update') await this.google.patch(op.calendarId!, op.eventId!, ev)
        else await this.google.remove(op.calendarId!, op.eventId!)
        done++
      } catch (err) {
        failed.push(`${op.op} "${op.title}": ${(err as Error).message}`)
      }
    }
    await this.refreshCalendar()
    return { done, failed }
  }

  // --- context updates -----------------------------------------------------
  async contextUpdate(instruction: string): Promise<ContextResult> {
    if (this.agent) throw new Error('A context update is already running.')
    if (this.pendingContext) throw new Error('Keep or undo the previous context update first.')
    await this.vault.git.flush()
    const root = this.vault.root
    const before = snapshotVault(root)
    try {
      this.agent = await runContextAgent(this.settings.contextEngine, root, instruction, (line) => this.emit('context-progress', line))
      const summary = await this.agent.done
      const after = snapshotVault(root)
      const changes: ContextChange[] = []
      for (const [path, text] of after) {
        const prev = before.get(path) ?? null
        if (prev !== text) changes.push({ path, before: prev, after: text })
      }
      this.pendingContext = { instruction, summary, changes: changes.sort((a, b) => a.path.localeCompare(b.path)) }
      if (!changes.length) this.pendingContext = null
      return { instruction, summary, changes }
    } catch (err) {
      // A cancelled or failed run must not leave half-made edits behind.
      this.restore(before, snapshotVault(root))
      throw err
    } finally {
      this.agent = null
      this.push()
    }
  }

  private restore(before: Map<string, string>, after: Map<string, string>) {
    for (const [path, text] of after) {
      const prev = before.get(path)
      if (prev === text) continue
      if (prev === undefined) rmSync(join(this.vault.root, path), { force: true })
      else writeFileSync(join(this.vault.root, path), prev)
    }
  }

  async contextCancel() {
    this.agent?.cancel()
  }

  async contextKeep() {
    const p = this.pendingContext
    if (!p) return
    this.pendingContext = null
    const short = p.instruction.replace(/\s+/g, ' ').slice(0, 60)
    await this.vault.git.commitNow(
      p.changes.map((c) => c.path),
      `planner: update context: ${short}${p.instruction.length > 60 ? '…' : ''}`,
      `Instruction: ${p.instruction}`
    )
    this.push()
  }

  async contextUndo() {
    const p = this.pendingContext
    if (!p) return
    this.pendingContext = null
    for (const c of p.changes) {
      const abs = join(this.vault.root, c.path)
      if (c.before === null) rmSync(abs, { force: true })
      else writeFileSync(abs, c.before)
    }
    this.push()
  }

  async closeCapture() {
    BrowserWindow.getFocusedWindow()?.close()
  }

  async dispose() {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    // Unreviewed agent edits are never kept implicitly.
    this.agent?.cancel()
    await this.contextUndo()
    await this.vault.close()
  }
}
