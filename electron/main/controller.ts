import { app, BrowserWindow, dialog, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Api, AppState, EstimateSuggestion, PlanOption, PlanVariant } from '@shared/api'
import type { CalEvent, CalendarStatus, ContextResult, Plan, Settings, SyncOp, Task, VaultState } from '@shared/types'
import { addDays, isoDate, isoWeek, localISO, startOfDay, weekStart } from '@shared/time'
import { nextOccurrence } from '@shared/repeat'
import { VaultService } from './vault/service'
import { GoogleCalendar } from './calendar/google'
import { MacCalendar } from './calendar/macos'
import type { CalendarProvider } from './calendar/provider'
import { buildSyncDiff } from './calendar/sync'
import { calendarEdits } from './calendar/adopt'
import { plan } from './scheduler/plan'
import { needsFullPlan, planningDay } from './scheduler/cadence'
import { PLAN_VARIANTS, applyVariant, planMetrics } from './scheduler/variants'
import { loadSettings, saveSettings } from './settings'
import { ContextSession } from './context/session'
import { askJson } from './context/ask'
import { BRIEF_FORMAT, DEFAULT_BRIEF_TEMPLATE, runBrief } from './context/brief'

/** Owns vault, calendar and the current plan; implements the renderer API. */
export class Controller implements Api {
  private settings: Settings = loadSettings()
  private vault!: VaultService
  private google = new GoogleCalendar(this.settings.googleClientId, this.settings.googleClientSecret)
  private mac = new MacCalendar()
  private calendar: CalendarStatus = { provider: 'macos', connected: false, configured: false, calendars: [] }
  /** Active calendar backend: macOS Calendar by default, Google directly as the alternative. */
  private get cal(): CalendarProvider {
    return this.settings.calendarProvider === 'google' ? this.google : this.mac
  }
  private events: CalEvent[] = []
  private refreshTimer: NodeJS.Timeout | null = null
  private context = new ContextSession(() => this.vault, () => this.settings.contextEngine, (line) => this.emit('context-progress', line))
  // Plan stability: full re-plans only on demand, once per day, or when preferences change.
  // Everything else is incremental (existing blocks stay put; only their contents refresh).
  private lastPlan: Plan | null = null
  private lastFullDay = ''
  private lastPrefsHash = ''
  private forceFull = false
  /** Strategy picked in Re-plan options; full re-plans keep using it until another is applied. */
  private variant: { key: PlanVariant; seed?: number } = { key: 'balanced' }
  // Calendar edits win: what was last synced, so moves/deletions made in the calendar can be detected.
  private synced: Record<string, { eventId?: string; calendarId: string; start: string; end: string }> = {}
  private dismissed: string[] = []
  private briefRunning = false
  private briefError: string | undefined
  private briefAttemptDay = ''
  private pushQueued = false
  /** Task ids already known (created by the app, or reviewed); others are new from outside. Null until seeded. */
  private seenTasks: Set<string> | null = null
  private lastCacheText = ''

  constructor(
    private broadcast: (state: AppState) => void,
    private emit: (channel: string, payload: unknown) => void
  ) {
    this.loadPlanCache()
    this.loadSyncState()
    this.openVault()
    this.refreshTimer = setInterval(() => void this.refreshCalendar().catch(() => {}), 10 * 60_000)
  }

  private openVault() {
    void this.vault?.close()
    this.vault = new VaultService(this.settings.vaultPath, () => this.settings.autoCommit, () => this.push())
    this.loadSeenTasks()
    this.vault.onOwnTaskIds = (ids) => {
      if (!ids.length || !this.seenTasks) return
      for (const id of ids) this.seenTasks.add(id)
      this.saveSeenTasks()
    }
    this.vault.startWatching()
  }

  private planCacheFile = () => join(app.getPath('userData'), 'plan-cache.json')

  private loadPlanCache() {
    try {
      if (!existsSync(this.planCacheFile())) return
      const c = JSON.parse(readFileSync(this.planCacheFile(), 'utf8'))
      if (c.vaultPath !== this.settings.vaultPath) return
      Object.assign(this, { lastPlan: c.plan, lastFullDay: c.fullDay, lastPrefsHash: c.prefsHash, variant: c.variant ?? { key: 'balanced' } })
    } catch {
      /* start fresh */
    }
  }

  private seenFile = () => join(app.getPath('userData'), 'seen-tasks.json')

  private loadSeenTasks() {
    this.seenTasks = null
    try {
      if (!existsSync(this.seenFile())) return
      const c = JSON.parse(readFileSync(this.seenFile(), 'utf8'))
      if (c.vaultPath === this.settings.vaultPath) this.seenTasks = new Set(c.ids)
    } catch {
      /* seeded again from the current file */
    }
  }

  private saveSeenTasks() {
    // Bounded: renamed or removed tasks leave stale ids behind.
    const ids = [...this.seenTasks!].slice(-5000)
    void writeFile(this.seenFile(), JSON.stringify({ vaultPath: this.settings.vaultPath, ids })).catch(() => {})
  }

  /** New from outside: open tasks not created by the app and not reviewed. The first run knows everything. */
  private newTaskIds(vault: VaultState): string[] {
    if (!this.seenTasks) {
      this.seenTasks = new Set(vault.tasks.map((t) => t.id))
      this.saveSeenTasks()
      return []
    }
    return vault.tasks.filter((t) => !t.done && !this.seenTasks!.has(t.id)).map((t) => t.id)
  }

  async acknowledgeTasks(ids: string[]) {
    if (!this.seenTasks) return
    for (const id of ids) this.seenTasks.add(id)
    this.saveSeenTasks()
    this.push()
  }

  private syncStateFile = () => join(app.getPath('userData'), 'sync-state.json')

  private loadSyncState() {
    try {
      if (!existsSync(this.syncStateFile())) return
      const c = JSON.parse(readFileSync(this.syncStateFile(), 'utf8'))
      if (c.vaultPath !== this.settings.vaultPath) return
      this.synced = c.synced ?? {}
      this.dismissed = c.dismissed ?? []
    } catch {
      /* start fresh */
    }
  }

  private saveSyncState() {
    // Forget dismissals older than a week (ids start with their date, e.g. 2026-11-09:thesis:1).
    const cutoff = isoDate(addDays(new Date(), -7))
    this.dismissed = this.dismissed.filter((id) => (id.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '9999') >= cutoff)
    try {
      writeFileSync(this.syncStateFile(), JSON.stringify({ vaultPath: this.settings.vaultPath, synced: this.synced, dismissed: this.dismissed }))
    } catch {
      /* best effort */
    }
  }

  /**
   * Your calendar edits win over the plan. A planner event moved or resized in the calendar becomes a
   * pin at its new time; one deleted there is dismissed and its work is planned elsewhere.
   */
  private adoptCalendarEdits(from: Date, loadedCalendarIds: string[]) {
    const edits = calendarEdits(this.synced, this.events, from, loadedCalendarIds, new Date())
    for (const d of edits.deleted) {
      this.dismissed.push(d.blockId)
      // Like removing it in the app: its time stays empty until Re-plan.
      this.vault.dismissBlock(d.blockId, localISO(new Date(d.start)), `${d.blockId} (deleted in calendar)`, localISO(new Date(d.end)))
      this.vault.unpin(d.blockId)
    }
    for (const id of edits.forget) delete this.synced[id]
    for (const { blockId, event: ev } of edits.moved) {
      const block = this.lastPlan?.blocks.find((b) => b.id === blockId)
      const category = block?.category ?? this.vault.preferences.categories.find((c) => c.calendar === ev.calendarName)?.key ?? 'other'
      this.vault.pin({
        blockId,
        category,
        title: ev.title,
        start: localISO(new Date(ev.start)),
        end: localISO(new Date(ev.end)),
        taskIds: block?.chunks.map((c) => c.taskId) ?? []
      })
      this.synced[blockId] = { ...this.synced[blockId], start: ev.start, end: ev.end }
    }
    if (edits.forget.length || edits.moved.length) this.saveSyncState()
  }

  private planningDay = () => planningDay(new Date())

  private computePlan(v: VaultState): Plan {
    const now = new Date()
    const day = this.planningDay()
    const prefsHash = JSON.stringify(v.preferences)
    const full = needsFullPlan({ forced: this.forceFull, hasPlan: Boolean(this.lastPlan), lastFullDay: this.lastFullDay, lastPrefsHash: this.lastPrefsHash, now, prefsHash })
    const p = this.runPlan(v, this.variant, now, full)
    if (full) {
      this.lastFullDay = day
      this.lastPrefsHash = prefsHash
      this.forceFull = false
    }
    this.lastPlan = p
    const cache = JSON.stringify({ vaultPath: this.settings.vaultPath, plan: p, fullDay: this.lastFullDay, prefsHash: this.lastPrefsHash, variant: this.variant })
    if (cache !== this.lastCacheText) {
      this.lastCacheText = cache
      void writeFile(this.planCacheFile(), cache).catch(() => {}) // cache is best effort
    }
    return p
  }

  private runPlan(v: VaultState, variant: { key: PlanVariant; seed?: number }, now: Date, full: boolean): Plan {
    return plan({
      tasks: v.tasks,
      events: this.events,
      prefs: applyVariant(v.preferences, variant.key),
      weeks: v.weeks,
      now,
      previous: this.lastPlan,
      anchorFuture: !full,
      excludeIds: this.dismissed,
      eventAvailability: this.settings.eventAvailability,
      fullPlannedAt: full ? undefined : this.lastPlan!.fullPlannedAt,
      seed: variant.seed
    })
  }

  async planOption(key: PlanVariant, seed?: number): Promise<PlanOption> {
    const v = this.vault.state()
    const now = new Date()
    // Previewed as Re-plan would do it: held time is released.
    const weeks = Object.fromEntries(Object.entries(v.weeks).map(([k, w]) => [k, { ...w, overrides: w.overrides && { ...w.overrides, holds: [] } }]))
    const p = this.runPlan({ ...v, weeks }, { key, seed }, now, true)
    const meta = PLAN_VARIANTS.find((x) => x.key === key)!
    return { ...meta, seed, plan: p, metrics: planMetrics(p, v.preferences, this.events, now) }
  }

  async applyPlanOption(key: PlanVariant, seed?: number) {
    this.variant = { key, seed }
    await this.replan()
  }

  private currentPlan(): Plan {
    return this.lastPlan ?? this.computePlan(this.vault.state())
  }

  /** Full re-plan on demand: everything not pinned or already started may move. */
  async replan() {
    this.forceFull = true
    this.vault.clearHolds(new Date())
    this.push()
  }

  async releaseHold(start: string, end: string) {
    this.mutate(() => this.vault.releaseHold(start, end))
  }

  // Day picks and week grids change where blocks go, so they re-plan fully (like a preference change).
  async setDayPick(week: string, ruleId: string, day: string | null) {
    this.forceFull = true
    this.mutate(() => this.vault.setDayPick(week, ruleId, day))
  }
  async setWeekGrid(week: string, grid: Parameters<Api['setWeekGrid']>[1]) {
    this.forceFull = true
    this.mutate(() => this.vault.setWeekGrid(week, grid))
  }
  async setWeekNotes(week: string, notes: string) {
    this.mutate(() => this.vault.setWeekNotes(week, notes))
  }
  async archiveDone() {
    return this.mutate(() => this.vault.archiveDone(new Date()))
  }

  async suggestEstimates(): Promise<EstimateSuggestion[]> {
    const v = this.vault.state()
    const openIds = new Set(v.tasks.filter((t) => !t.done).map((t) => t.id))
    const todo = v.tasks.filter((t) => !t.done && !t.estimateMin && !t.childIds.some((id) => openIds.has(id))).slice(0, 80)
    if (!todo.length) return []
    const label = (key: string) => v.preferences.categories.find((c) => c.key === key)?.label ?? key
    const examples = v.tasks.filter((t) => t.estimateMin).slice(0, 40)
    const prompt = [
      "Estimate how long each task below will take the user (remaining effort, in minutes). Tasks are in Portuguese or English. Use the task's area and heading as context, and calibrate against the user's own estimates when there are any.",
      'Answer with JSON only: [{"n": <task number>, "minutes": <multiple of 15, 15-480>, "why": "<at most 6 words>"}], one entry per task.',
      examples.length ? `\nThe user's own estimates:\n${examples.map((t) => `- ${t.title} [${label(t.category)} › ${t.section.join(' › ')}] = ${t.estimateMin} min`).join('\n')}` : '',
      `\nTasks to estimate:\n${todo.map((t, i) => `${i + 1}. ${t.title} [${label(t.category)} › ${t.section.join(' › ')}]${t.due ? ` due ${t.due}` : ''}`).join('\n')}`
    ].join('\n')
    const answer = await askJson<{ n: number; minutes: number; why?: string }[]>(prompt)
    if (!Array.isArray(answer)) throw new Error("The model's answer wasn't a list. Try again.")
    return answer
      .filter((a) => Number.isInteger(a.n) && todo[a.n - 1] && Number(a.minutes) > 0)
      .map((a) => {
        const t = todo[a.n - 1]
        return { taskId: t.id, title: t.title, section: t.section, category: t.category, minutes: Math.min(480, Math.max(15, Math.round(Number(a.minutes) / 15) * 15)), why: String(a.why ?? '').slice(0, 80) }
      })
  }

  async applyEstimates(minutesById: Record<string, number>) {
    const titles = new Map(this.vault.state().tasks.map((t) => [t.id, t.title]))
    this.mutate(() => {
      for (const [id, min] of Object.entries(minutesById)) if (titles.has(id) && min > 0) this.vault.patchTask(id, { estimateMin: min }, `estimate "${titles.get(id)}"`)
    })
  }

  async getState(): Promise<AppState> {
    const vault = this.vault.state()
    const p = this.computePlan(vault)
    const gitError = this.vault.git.lastError
    return {
      vault: gitError ? { ...vault, errors: [...vault.errors, `Couldn't commit to the vault's git history (will retry): ${gitError}`] } : vault,
      plan: p,
      planVariant: { ...this.variant, label: PLAN_VARIANTS.find((x) => x.key === this.variant.key)?.label ?? 'Balanced' },
      events: this.events,
      calendar: { ...this.calendar, provider: this.cal.kind, connected: this.cal.connected, configured: this.cal.configured },
      settings: { ...this.settings, googleClientSecret: this.settings.googleClientSecret ? '••••••' : undefined },
      brief: { running: this.briefRunning, error: this.briefError },
      newTaskIds: this.newTaskIds(vault)
    }
  }

  /** Several changes in one tick (a mutation plus its follow-ups) become one re-plan and one broadcast. */
  push() {
    if (this.pushQueued) return
    this.pushQueued = true
    setImmediate(() => {
      this.pushQueued = false
      void this.getState().then(this.broadcast, (err) => console.error('[state]', err))
    })
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
    this.mutate(() => {
      this.vault.patchTask(taskId, patch, `${what} "${title}"`)
      if (patch.done === false) this.untrackCompletion(title)
    })
  }

  /**
   * Check a task off now. Unless it sits in a block running right now, a short block ending now
   * records when it was done (logged, pinned, and synced like any planner block).
   */
  async completeTask(taskId: string) {
    const task = this.vault.state().tasks.find((t) => t.id === taskId)
    if (!task) throw new Error('That task changed or was removed. Try again.')
    const now = new Date()
    if (task.perWeek) return this.logHabitSession(task, now)
    const minutes = this.vault.preferences.completedTaskMinutes
    const running = this.currentPlan().blocks.some((b) => b.chunks.some((c) => c.taskId === taskId) && new Date(b.start) <= now && now < new Date(b.end))
    this.mutate(() => {
      this.vault.patchTask(taskId, { done: true }, `complete "${task.title}"`)
      if (!minutes || running) return
      const end = new Date(Math.floor(now.getTime() / 300_000) * 300_000)
      const start = localISO(new Date(end.getTime() - minutes * 60_000))
      const blockId = `done:${isoDate(now)}:${taskId}`
      const title = doneTitle(task.title)
      // A repeating task's open copy keeps this id, so the block must not pull it in.
      const taskIds = task.repeat ? [] : [taskId]
      const pin = { blockId, category: task.category, title, start, end: localISO(end), taskIds }
      this.vault.logBlock({ blockId, date: isoDate(now), category: task.category, title, start, plannedMin: minutes, actualMin: minutes, status: 'done', taskIds }, pin)
    })
  }

  /**
   * A habit (`3x/week`) is never checked off: each check logs one session and the line stays open.
   * Inside a block running now, that block is logged; otherwise a block of the session's length ending now.
   */
  private logHabitSession(task: Task, now: Date) {
    const block = this.currentPlan().blocks.find((b) => b.chunks.some((c) => c.taskId === task.id) && new Date(b.start) <= now && now < new Date(b.end))
    this.mutate(() => {
      if (block) {
        const planned = Math.round((new Date(block.end).getTime() - new Date(block.start).getTime()) / 60_000)
        const elapsed = Math.min(planned, Math.max(5, Math.round((now.getTime() - new Date(block.start).getTime()) / 300_000) * 5))
        const taskIds = block.chunks.map((c) => c.taskId)
        const entry = { blockId: block.id, date: block.start.slice(0, 10), category: block.category, title: block.title, start: block.start, plannedMin: planned, actualMin: elapsed, status: 'done' as const, taskIds }
        this.vault.logBlock(entry, { blockId: block.id, category: block.category, title: block.title, start: block.start, end: block.end, taskIds })
        return
      }
      const minutes = task.estimateMin ?? this.vault.preferences.categories.find((c) => c.key === task.category)?.defaultEstimateMinutes ?? 30
      const end = new Date(Math.floor(now.getTime() / 300_000) * 300_000)
      const start = localISO(new Date(end.getTime() - minutes * 60_000))
      const blockId = `done:${isoDate(now)}:${task.id}:${end.getTime()}`
      const title = doneTitle(task.title)
      const pin = { blockId, category: task.category, title, start, end: localISO(end), taskIds: [task.id] }
      this.vault.logBlock({ blockId, date: isoDate(now), category: task.category, title, start, plannedMin: minutes, actualMin: minutes, status: 'done', taskIds: [task.id] }, pin)
    })
  }

  /**
   * Skip one occurrence of a repeating task. The line stays and keeps its `repeat:` rule; only
   * `due:` moves to the next occurrence, so the series survives. Nothing is marked done, so a
   * skipped occurrence never counts as completed work.
   */
  async skipOccurrence(taskId: string) {
    const task = this.vault.state().tasks.find((t) => t.id === taskId)
    if (!task) throw new Error('That task changed or was removed. Try again.')
    if (!task.repeat) throw new Error('That task does not repeat, so there is no occurrence to skip.')
    const next = nextOccurrence(task.repeat, task.due, new Date())
    if (!next) throw new Error(`Can't read the repeat rule "${task.repeat}".`)
    this.mutate(() => this.vault.patchTask(taskId, { due: next, postponed: null }, `skip one "${task.title}"`))
    return next
  }

  /** Postpone every open task in a block (null: stop postponing them). */
  async postponeBlock(blockId: string, until: string | null) {
    const b = this.blockById(blockId)
    const open = new Set(this.vault.state().tasks.filter((t) => !t.done).map((t) => t.id))
    const ids = b.chunks.map((c) => c.taskId).filter((id) => open.has(id))
    if (!ids.length) throw new Error('No open tasks in this block.')
    this.mutate(() => {
      for (const id of ids) this.vault.patchTask(id, { postponed: until }, `${until ? `postpone to ${until}` : 'stop postponing'} "${this.taskTitle(id)}"`)
    })
  }

  /** Reopening a task drops today's check-off block for it. */
  private untrackCompletion(title: string) {
    const today = isoDate(new Date())
    const week = this.vault.state().weeks[isoWeek(new Date())]
    for (const p of week?.pins ?? []) {
      if (!p.blockId.startsWith(`done:${today}:`) || p.title !== doneTitle(title)) continue
      this.vault.unpin(p.blockId)
      this.vault.unlog(p.blockId, p.start)
    }
  }
  async addTask(section: string[], body: string) {
    this.mutate(() => this.vault.addTask(section, body))
  }
  async indentTask(taskId: string, dir: 'in' | 'out') {
    const title = this.taskTitle(taskId)
    this.mutate(() => this.vault.indentTask(taskId, dir, title))
  }
  async reorderTask(taskId: string, targetId: string, position: 'before' | 'after') {
    const title = this.taskTitle(taskId)
    this.mutate(() => this.vault.reorderTask(taskId, targetId, position, title))
  }
  async addSubtask(parentId: string, body: string) {
    const title = this.taskTitle(parentId)
    this.mutate(() => this.vault.addSubtask(parentId, body, title))
  }
  async deleteTask(taskId: string) {
    const title = this.taskTitle(taskId)
    this.mutate(() => this.vault.deleteTask(taskId, title))
  }
  async addInbox(text: string) {
    // Quick capture works while Update context runs; the line is written once it's done.
    await this.context.running
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

  // --- brief ---------------------------------------------------------------
  async getBrief(date: string) {
    return this.vault.brief(date)
  }

  /** First open of the planning day (and on focus): generate the brief once if today's file is missing. */
  async maybeRunBrief() {
    const day = this.planningDay()
    // Dev runs never spend a model call on their own; "Run daily brief" still works there.
    if (!app.isPackaged) return
    if (!this.settings.briefAuto || this.briefRunning || this.context.running || this.briefAttemptDay === day) return
    if (this.vault.read(`05_Tasks/briefs/${isoDate(new Date())}.md`) !== null) return
    this.briefAttemptDay = day
    await this.generateBrief().catch(() => {})
  }

  async generateBrief() {
    if (this.briefRunning) return
    this.briefRunning = true
    this.briefError = undefined
    this.push()
    const date = isoDate(new Date())
    try {
      // Only the calendars shown in the app (Calendars menu); hidden ones never reach the brief.
      const hidden = new Set(this.settings.hiddenCalendars ?? [])
      const today = this.events.filter((e) => e.start.slice(0, 10) <= date && e.end.slice(0, 10) >= date && !e.plannerBlockId && !hidden.has(e.calendarName))
      const template = this.vault.readBriefPrompt() ?? DEFAULT_BRIEF_TEMPLATE
      const md = await runBrief(this.vault.root, template, date, today, this.settings.briefEmail, (line) => this.emit('brief-progress', line))
      this.vault.writeBrief(date, md)
    } catch (err) {
      this.briefError = (err as Error).message
    } finally {
      this.briefRunning = false
      this.push()
    }
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
    if (!app.isPackaged) next.vaultPath = this.settings.vaultPath
    const vaultChanged = next.vaultPath !== this.settings.vaultPath
    const googleChanged = next.googleClientId !== this.settings.googleClientId || next.googleClientSecret !== this.settings.googleClientSecret
    this.settings = next
    saveSettings(next)
    if (vaultChanged) {
      this.lastPlan = null
      this.openVault()
    }
    if (googleChanged && next.googleClientId && next.googleClientSecret) this.google.configure(next.googleClientId, next.googleClientSecret)
    if (patch.calendarProvider) {
      this.events = []
      void this.refreshCalendar()
    }
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
    await this.cal.connect()
    await this.refreshCalendar()
  }

  async disconnectCalendar() {
    this.cal.disconnect()
    this.events = []
    this.calendar = { provider: this.cal.kind, connected: false, configured: this.cal.configured, calendars: [] }
    this.push()
  }

  async refreshCalendar() {
    if (this.cal === this.mac && this.mac.connected === false) await this.mac.check().catch(() => {})
    if (!this.cal.connected) return
    try {
      const calendars = await this.cal.calendars()
      const prefs = this.vault.preferences
      const from = addDays(weekStart(new Date()), -7)
      const to = addDays(startOfDay(new Date()), prefs.horizonDays + 7)
      this.events = await this.cal.events(calendars, from, to)
      if (!this.context.running) this.adoptCalendarEdits(from, calendars.map((c) => c.id))
      this.calendar = { provider: this.cal.kind, connected: true, configured: true, calendars, lastRefresh: new Date().toISOString() }
    } catch (err) {
      this.calendar = { ...this.calendar, error: String((err as Error).message ?? err) }
    }
    this.push()
  }

  async syncPreview(day?: string) {
    await this.refreshCalendar()
    const v = this.vault.state()
    return buildSyncDiff(this.currentPlan().blocks, this.events, this.calendar.calendars, v.preferences, v.tasks, new Date(), day)
  }

  async syncApply(ops: SyncOp[]) {
    const failed: string[] = []
    let done = 0
    for (const op of ops) {
      try {
        const ev = { title: op.title, start: op.start, end: op.end, description: op.description }
        if (op.op === 'create') {
          const eventId = await this.cal.insert(op.calendarId!, op.blockId, ev)
          this.synced[op.blockId] = { eventId, calendarId: op.calendarId!, start: op.start, end: op.end }
        } else if (op.op === 'update') {
          await this.cal.patch(op.calendarId!, op.eventId!, ev, op.blockId)
          this.synced[op.blockId] = { eventId: op.eventId, calendarId: op.calendarId!, start: op.start, end: op.end }
        } else {
          await this.cal.remove(op.calendarId!, op.eventId!)
          delete this.synced[op.blockId]
        }
        done++
      } catch (err) {
        failed.push(`${op.op} "${op.title}": ${(err as Error).message}`)
      }
    }
    this.saveSyncState()
    await this.refreshCalendar()
    return { done, failed }
  }

  // --- context updates -----------------------------------------------------
  async contextUpdate(instruction: string): Promise<ContextResult> {
    try {
      return await this.context.update(instruction)
    } finally {
      this.push()
    }
  }
  async contextCancel() {
    this.context.cancel()
  }
  async contextKeep() {
    await this.context.keep()
    this.push()
  }
  async contextUndo(): Promise<string[]> {
    const skipped = this.context.undo()
    this.push()
    return skipped
  }

  // --- brief prompt, calendar display, block editing --------------------------
  // Agent A: brief prompt
  async getBriefPrompt(): Promise<{ custom: string | null; defaultText: string; format: string }> {
    return { custom: this.vault.readBriefPrompt(), defaultText: DEFAULT_BRIEF_TEMPLATE, format: BRIEF_FORMAT }
  }
  /** null = reset: write the default text rather than deleting a vault file. */
  async saveBriefPrompt(text: string | null): Promise<void> {
    this.vault.writeBriefPrompt(text ?? DEFAULT_BRIEF_TEMPLATE)
  }
  // Agent B: calendar visibility & availability
  async setCalendarVisible(calendarName: string, visible: boolean): Promise<void> {
    const hidden = (this.settings.hiddenCalendars ?? []).filter((n) => n !== calendarName)
    if (!visible) hidden.push(calendarName)
    await this.saveSettings({ hiddenCalendars: hidden })
  }
  /** Busy = the planner works around the calendar's events; free = they're in ignoreCalendars. Prefs change → full re-plan. */
  async setCalendarBusy(calendarName: string, busy: boolean): Promise<void> {
    const prefs = this.vault.state().preferences
    const ignoreCalendars = prefs.ignoreCalendars.filter((n) => n !== calendarName)
    if (!busy) ignoreCalendars.push(calendarName)
    this.mutate(() => this.vault.savePreferences({ ...prefs, ignoreCalendars }))
  }
  /** Checks for a hand edit of a calendar event; the edit itself goes through the provider's user* methods only. */
  private editableEvent(calendarId: string, eventId: string): CalEvent {
    const ev = this.events.find((e) => e.calendarId === calendarId && e.id === eventId)
    if (!ev) throw new Error('That event changed in your calendar. Refresh and try again.')
    if (ev.plannerBlockId) throw new Error('Planner events are changed through their block.')
    const prefs = this.vault.preferences
    if (prefs.protectedCalendars.some((p) => ev.calendarName.toLowerCase().startsWith(p.toLowerCase()))) throw new Error(`"${ev.calendarName}" is protected; the app never changes it.`)
    if (this.calendar.calendars.find((c) => c.id === calendarId)?.writable === false) throw new Error(`"${ev.calendarName}" is read-only.`)
    return ev
  }
  async editEvent(calendarId: string, eventId: string, change: { title?: string; start?: string; end?: string }): Promise<string> {
    const ev = this.editableEvent(calendarId, eventId)
    if ((change.start || change.end) && ev.allDay) throw new Error('All-day events can only be renamed here.')
    const start = new Date(change.start ?? ev.start).getTime()
    const end = new Date(change.end ?? ev.end).getTime()
    if (!(end > start)) throw new Error('The end must be after the start.')
    if (change.title !== undefined && !change.title.trim()) throw new Error('The title can’t be empty.')
    const id = await this.cal.userUpdate(calendarId, eventId, change)
    // Its busy/free override follows it to the new id.
    const overrides = this.settings.eventAvailability ?? {}
    const old = overrides[`${calendarId}:${eventId}`]
    if (old && id !== eventId) {
      const { [`${calendarId}:${eventId}`]: _drop, ...rest } = overrides
      await this.saveSettings({ eventAvailability: { ...rest, [`${calendarId}:${id}`]: old } })
    }
    await this.refreshCalendar()
    return id
  }
  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    this.editableEvent(calendarId, eventId)
    await this.cal.userRemove(calendarId, eventId)
    await this.refreshCalendar()
  }
  async setEventAvailability(eventKey: string, value: 'busy' | 'free' | null): Promise<void> {
    const eventAvailability = { ...(this.settings.eventAvailability ?? {}) }
    if (value) eventAvailability[eventKey] = value
    else delete eventAvailability[eventKey]
    await this.saveSettings({ eventAvailability })
  }
  // Agent C: block editing
  private blockById(blockId: string) {
    const b = this.currentPlan().blocks.find((x) => x.id === blockId)
    if (!b) throw new Error('That block is no longer in the plan. Try again after it refreshes.')
    return b
  }

  /** Same shape as the renderer's pinFromBlock: the block keeps its id and time. */
  private pinBlock(b: Plan['blocks'][number], taskIds: string[]) {
    this.vault.pin({ blockId: b.id, category: b.category, title: b.title, start: b.start, end: b.end, taskIds, ...(b.fill ? { fill: true } : {}) })
  }

  async addTaskToBlock(blockId: string, taskId: string) {
    const b = this.blockById(blockId)
    if (b.kind === 'break') throw new Error("Breaks can't hold tasks.")
    const label = `"${this.taskTitle(taskId)}" into ${b.title}`
    this.mutate(() => {
      this.vault.removeExclusion(b.id, b.start, taskId, label)
      const ids = b.chunks.map((c) => c.taskId)
      // Containers are the user's own events: never pinned, the planner fills them from the assignment.
      if (b.kind === 'container') this.vault.addAssignment(b.id, b.start, taskId, label)
      else if (!ids.includes(taskId)) this.pinBlock(b, [...ids, taskId])
    })
  }

  async removeTaskFromBlock(blockId: string, taskId: string) {
    const b = this.blockById(blockId)
    const label = `"${this.taskTitle(taskId)}" out of ${b.title}`
    this.mutate(() => {
      this.vault.removeAssignment(b.id, b.start, taskId, label)
      if (b.kind === 'pinned') this.pinBlock(b, b.chunks.map((c) => c.taskId).filter((id) => id !== taskId))
      // A drawn block is also filled automatically: keep the planner from putting the task back.
      if (b.kind !== 'pinned' || b.fill) this.vault.addExclusion(b.id, b.start, taskId, label)
    })
  }

  /** Planner blocks disappear (a synced one is removed from the calendar at the next Sync); containers just stop being filled. */
  async removeBlock(blockId: string) {
    const b = this.blockById(blockId)
    const label = `${b.title} ${b.start.slice(0, 16).replace('T', ' ')}`
    this.mutate(() => {
      if (b.kind === 'pinned') this.vault.unpin(b.id)
      // Its time stays empty until Re-plan, so the user can put something else there first.
      this.vault.dismissBlock(b.id, b.start, label, b.kind === 'container' ? undefined : b.end)
    })
  }

  async restoreBlock(block: Parameters<Api['restoreBlock']>[0]) {
    this.mutate(() => {
      this.vault.restoreBlock(block.id, block.start, `"${block.title}"`, block.end)
      if (block.kind === 'pinned')
        this.vault.pin({ blockId: block.id, category: block.category, title: block.title, start: block.start, end: block.end, taskIds: block.chunks.map((c) => c.taskId), ...(block.fill ? { fill: true } : {}) })
    })
  }

  async closeCapture() {
    BrowserWindow.getFocusedWindow()?.close()
  }

  async dispose() {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    // Unreviewed agent edits are never kept implicitly.
    this.context.cancel()
    await this.context.running
    this.context.undo()
    await this.vault.close()
  }
}

const doneTitle = (title: string) => `✓ ${title.replace(/\*\*|`/g, '')}`
