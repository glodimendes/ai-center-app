import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import type { BriefData, TaskNote, DocContent, DocInfo, LogEntry, Pin, Preferences, TaskPatch, VaultState, WeekData, WeekOverrides, Weekday } from '@shared/types'
import { isoDate, isoWeek } from '@shared/time'
import { parseInbox, parseTasks } from './parser'
import { addInboxItem, addSubtask, deleteTask, indentTask, insertTask, patchTask, removeInboxItem, reorderTask, stampLastUpdated, takeDone } from './edits'
import { DEFAULT_PREFERENCES, PREFERENCES_FILE, parsePreferences, serializePreferences } from './preferences'
import { WEEKLY_DIR, parseWeekly, serializeWeekly, weeklyFile } from './weekly'
import { VaultGit } from './git'

export const TODOS_FILE = '05_Tasks/daily-todos.md'
export const INBOX_FILE = '05_Tasks/braindump-inbox.md'
export const BRIEF_PROMPT_FILE = '06_Prompts/daily-brief.md'
export const archiveFile = (year: string) => `05_Tasks/archive/done-${year}.md`

const DOC_GROUPS: [string, string][] = [
  ['04_Context_Docs', 'Context'],
  ['01_Profile', 'Profile'],
  ['02_Projects', 'Projects'],
  ['05_Tasks', 'Task notes'],
  ['07_Decisions', 'Decisions'],
  ['03_Workflows', 'Workflows'],
  ['06_Prompts', 'Prompts'],
  ['09_Tools', 'Tools']
]

const sha = (s: string) => createHash('sha1').update(s).digest('hex')

export class VaultService {
  private watcher: FSWatcher | null = null
  private changeTimer: NodeJS.Timeout | null = null
  /** Called with the ids of tasks the app's own edits create, so only lines added elsewhere count as new. */
  onOwnTaskIds: (ids: string[]) => void = () => {}
  /** What the app itself last wrote per file: the watcher event that write causes is not news. */
  private ownWrites = new Map<string, string>()
  readonly git: VaultGit

  constructor(
    readonly root: string,
    autoCommit: () => boolean,
    private onChange: () => void
  ) {
    this.git = new VaultGit(root, autoCommit, onChange)
  }

  private abs(rel: string) {
    const p = resolve(this.root, rel)
    if (relative(this.root, p).startsWith('..')) throw new Error(`Path outside vault: ${rel}`)
    return p
  }

  read(rel: string): string | null {
    const p = this.abs(rel)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

  private write(rel: string, text: string, message: string) {
    const p = this.abs(rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, text)
    this.ownWrites.set(p, text)
    this.git.record(rel, message)
  }

  /** Read-modify-write against the file as it is on disk right now. */
  private update(rel: string, fn: (text: string) => string, message: string) {
    const text = this.read(rel)
    if (text === null) throw new Error(`${rel} not found in the vault.`)
    const next = fn(text)
    if (next === text) return
    this.write(rel, next, message)
    if (rel === TODOS_FILE) {
      const cats = this.preferences.categories
      const before = new Set(parseTasks(text, TODOS_FILE, cats, new Date()).tasks.map((t) => t.id))
      this.onOwnTaskIds(parseTasks(next, TODOS_FILE, cats, new Date()).tasks.map((t) => t.id).filter((id) => !before.has(id)))
    }
  }

  get preferences(): Preferences {
    const text = this.read(PREFERENCES_FILE)
    return text ? parsePreferences(text) : DEFAULT_PREFERENCES
  }

  state(): VaultState {
    const errors: string[] = []
    const today = new Date()
    const prefs = this.preferences
    const todos = this.read(TODOS_FILE)
    if (todos === null) errors.push(`${TODOS_FILE} not found.`)
    const { tasks, sections } = todos ? parseTasks(todos, TODOS_FILE, prefs.categories, today) : { tasks: [], sections: [] }
    const inboxText = this.read(INBOX_FILE)
    return {
      vaultPath: this.root,
      tasks,
      sections,
      inbox: inboxText ? parseInbox(inboxText, INBOX_FILE) : [],
      preferences: prefs,
      preferencesFileExists: this.read(PREFERENCES_FILE) !== null,
      weeks: this.weeks(),
      errors
    }
  }

  weeks(): Record<string, WeekData> {
    const dir = this.abs(WEEKLY_DIR)
    if (!existsSync(dir)) return {}
    const out: Record<string, WeekData> = {}
    for (const f of readdirSync(dir)) {
      const m = f.match(/^(\d{4}-W\d{2})\.md$/)
      if (m) out[m[1]] = parseWeekly(readFileSync(join(dir, f), 'utf8'), m[1])
    }
    return out
  }

  private updateWeek(week: string, fn: (w: WeekData) => void, message: string) {
    const rel = weeklyFile(week)
    const text = this.read(rel)
    const data = text ? parseWeekly(text, week) : { week, log: [], pins: [] }
    fn(data)
    this.write(rel, serializeWeekly(data, this.preferences.categories), message)
  }

  // --- tasks ---------------------------------------------------------------
  patchTask(taskId: string, patch: TaskPatch, label: string) {
    const prefs = this.preferences
    this.update(TODOS_FILE, (t) => patchTask(t, TODOS_FILE, taskId, patch, prefs.categories, new Date()), label)
  }

  addTask(section: string[], body: string) {
    this.update(TODOS_FILE, (t) => insertTask(t, section, body), `add "${body}"`)
  }

  indentTask(taskId: string, dir: 'in' | 'out', title: string) {
    const prefs = this.preferences
    this.update(TODOS_FILE, (t) => indentTask(t, TODOS_FILE, taskId, dir, prefs.categories, new Date()), `${dir === 'in' ? 'nest' : 'un-nest'} "${title}"`)
  }

  reorderTask(taskId: string, targetId: string, position: 'before' | 'after', title: string) {
    const prefs = this.preferences
    this.update(TODOS_FILE, (t) => reorderTask(t, TODOS_FILE, taskId, targetId, position, prefs.categories, new Date()), `reorder "${title}"`)
  }

  addSubtask(parentId: string, body: string, parentTitle: string) {
    const prefs = this.preferences
    this.update(TODOS_FILE, (t) => addSubtask(t, TODOS_FILE, parentId, body, prefs.categories, new Date()), `add "${body}" under "${parentTitle}"`)
  }

  deleteTask(taskId: string, title: string) {
    const prefs = this.preferences
    this.update(TODOS_FILE, (t) => deleteTask(t, TODOS_FILE, taskId, prefs.categories, new Date()), `delete "${title}"`)
  }

  // --- inbox ---------------------------------------------------------------
  addInbox(text: string) {
    this.update(INBOX_FILE, (t) => addInboxItem(t, text, new Date()), `capture "${text}"`)
  }

  inboxToTask(itemId: string, text: string, section: string[]) {
    this.addTask(section, text)
    this.update(INBOX_FILE, (t) => removeInboxItem(t, INBOX_FILE, itemId), `move inbox item to ${section.join(' › ')}`)
  }

  removeInbox(itemId: string) {
    this.update(INBOX_FILE, (t) => removeInboxItem(t, INBOX_FILE, itemId), 'remove inbox item')
  }

  // --- log & pins ----------------------------------------------------------
  logBlock(entry: LogEntry, pin?: Pin) {
    const week = isoWeek(new Date(entry.start))
    this.updateWeek(
      week,
      (w) => {
        w.log = w.log.filter((l) => l.blockId !== entry.blockId)
        w.log.push(entry)
        if (pin && !w.pins.some((p) => p.blockId === pin.blockId)) w.pins.push(pin)
      },
      `log ${entry.actualMin} min on "${entry.title}"`
    )
  }

  unlog(blockId: string, start: string) {
    this.updateWeek(isoWeek(new Date(start)), (w) => (w.log = w.log.filter((l) => l.blockId !== blockId)), 'remove log entry')
  }

  pin(pin: Pin) {
    // A block may move across weeks: drop it everywhere first.
    for (const [week, data] of Object.entries(this.weeks())) {
      if (data.pins.some((p) => p.blockId === pin.blockId)) this.updateWeek(week, (w) => (w.pins = w.pins.filter((p) => p.blockId !== pin.blockId)), 'move block')
    }
    this.updateWeek(isoWeek(new Date(pin.start)), (w) => w.pins.push(pin), `pin "${pin.title}" at ${pin.start.slice(0, 16).replace('T', ' ')}`)
  }

  unpin(blockId: string) {
    for (const [week, data] of Object.entries(this.weeks())) {
      if (data.pins.some((p) => p.blockId === blockId)) this.updateWeek(week, (w) => (w.pins = w.pins.filter((p) => p.blockId !== blockId)), 'unpin block')
    }
  }

  // --- manual block edits (weekly overrides, in the week of the block's start) ---
  private updateOverrides(start: string, fn: (o: WeekOverrides) => void, message: string) {
    this.updateWeek(
      isoWeek(new Date(start)),
      (w) => {
        const o = w.overrides ?? {}
        fn(o)
        w.overrides = o
      },
      message
    )
  }

  addAssignment(blockId: string, start: string, taskId: string, label = `"${taskId}" into ${blockId}`) {
    this.updateOverrides(
      start,
      (o) => {
        const list = (o.assignments ??= [])
        const a = list.find((x) => x.blockId === blockId)
        if (!a) list.push({ blockId, taskIds: [taskId] })
        else if (!a.taskIds.includes(taskId)) a.taskIds.push(taskId)
      },
      `put ${label}`
    )
  }

  /** No-op (no write, no commit) when the pair isn't stored. */
  removeAssignment(blockId: string, start: string, taskId: string, label = `"${taskId}" from ${blockId}`) {
    const o = this.weeks()[isoWeek(new Date(start))]?.overrides
    if (!o?.assignments?.some((a) => a.blockId === blockId && a.taskIds.includes(taskId))) return
    this.updateOverrides(
      start,
      (o) => (o.assignments = (o.assignments ?? []).map((a) => (a.blockId === blockId ? { ...a, taskIds: a.taskIds.filter((t) => t !== taskId) } : a))),
      `unassign ${label}`
    )
  }

  addExclusion(blockId: string, start: string, taskId: string, label = `"${taskId}" from ${blockId}`) {
    this.updateOverrides(
      start,
      (o) => {
        const list = (o.exclusions ??= [])
        if (!list.some((x) => x.blockId === blockId && x.taskId === taskId)) list.push({ blockId, taskId })
      },
      `take ${label}`
    )
  }

  /** No-op (no write, no commit) when the pair isn't stored. */
  removeExclusion(blockId: string, start: string, taskId: string, label = `"${taskId}" in ${blockId}`) {
    const o = this.weeks()[isoWeek(new Date(start))]?.overrides
    if (!o?.exclusions?.some((x) => x.blockId === blockId && x.taskId === taskId)) return
    this.updateOverrides(start, (o) => (o.exclusions = (o.exclusions ?? []).filter((x) => !(x.blockId === blockId && x.taskId === taskId))), `allow ${label}`)
  }

  restoreBlock(blockId: string, start: string, label = blockId, end?: string) {
    const o = this.weeks()[isoWeek(new Date(start))]?.overrides
    const held = end && o?.holds?.some((h) => h.start === start && h.end === end)
    if (!o?.dismissed?.includes(blockId) && !held) return
    this.updateOverrides(
      start,
      (o) => {
        o.dismissed = (o.dismissed ?? []).filter((id) => id !== blockId)
        o.holds = (o.holds ?? []).filter((h) => !(h.start === start && h.end === end))
      },
      `restore block ${label}`
    )
  }

  /** `end` given: the block's time is also held empty until the next Re-plan. */
  dismissBlock(blockId: string, start: string, label = blockId, end?: string) {
    this.updateOverrides(
      start,
      (o) => {
        const list = (o.dismissed ??= [])
        if (!list.includes(blockId)) list.push(blockId)
        // Its manual contents go with it.
        o.assignments = (o.assignments ?? []).filter((a) => a.blockId !== blockId)
        o.exclusions = (o.exclusions ?? []).filter((x) => x.blockId !== blockId)
        if (end && !(o.holds ?? []).some((h) => h.start === start && h.end === end)) (o.holds ??= []).push({ start, end })
      },
      `remove block ${label}`
    )
  }

  releaseHold(start: string, end: string) {
    const o = this.weeks()[isoWeek(new Date(start))]?.overrides
    if (!o?.holds?.some((h) => h.start === start && h.end === end)) return
    this.updateOverrides(start, (o) => (o.holds = (o.holds ?? []).filter((h) => !(h.start === start && h.end === end))), `free up ${start.slice(0, 16).replace('T', ' ')}`)
  }

  /** Re-plan: held time that hasn't passed yet becomes plannable again. */
  /** "One day per week" rule: this week's day (null: let the planner pick again). */
  setDayPick(week: string, ruleId: string, day: string | null) {
    this.updateWeek(
      week,
      (w) => {
        const picks = { ...(w.overrides?.dayPicks ?? {}) }
        if (day) picks[ruleId] = day
        else delete picks[ruleId]
        w.overrides = { ...w.overrides, dayPicks: picks }
      },
      day ? `${ruleId} on ${day}` : `${ruleId}: planner picks the day`
    )
  }

  /** This week's own grid hours (null: back to the grid from Settings). */
  setWeekGrid(week: string, grid: Record<string, Partial<Record<Weekday, number>>> | null) {
    this.updateWeek(week, (w) => (w.overrides = { ...w.overrides, grid: grid ?? undefined }), grid ? `hours for ${week}` : `${week} uses the usual hours`)
  }

  /** Day rules and grid of a week, as written by "Plan with a wish". */
  setWeekPlanOverrides(week: string, o: Pick<WeekOverrides, 'dayRules' | 'grid'>, message: string) {
    this.updateWeek(week, (w) => (w.overrides = { ...w.overrides, dayRules: o.dayRules, grid: o.grid }), message)
  }

  removeWeekRule(week: string, ruleId: string) {
    this.updateWeek(week, (w) => (w.overrides = { ...w.overrides, dayRules: (w.overrides?.dayRules ?? []).filter((r) => r.id !== ruleId) }), 'remove a wish')
  }

  setWeekNotes(week: string, notes: string) {
    this.updateWeek(week, (w) => (w.notes = notes.trim() || undefined), `focus for ${week}`)
  }

  /** Moves checked tasks from the todo file to this year's archive file. Returns how many tasks moved. */
  archiveDone(now: Date): number {
    const text = this.read(TODOS_FILE)
    if (text === null) throw new Error(`${TODOS_FILE} not found in the vault.`)
    const { text: rest, taken } = takeDone(text, TODOS_FILE, this.preferences.categories, now)
    if (!taken.length) return 0
    const rel = archiveFile(String(now.getFullYear()))
    const archive = this.read(rel) ?? `# Done tasks ${now.getFullYear()}\n\nChecked tasks moved out of \`${TODOS_FILE}\` by the AI Center app in the weekly review. The app only appends here.\n`
    const bySection = new Map<string, string[]>()
    for (const t of taken) bySection.set(t.section.join(' › ') || 'No heading', [...(bySection.get(t.section.join(' › ') || 'No heading') ?? []), ...t.lines])
    const block = [`## ${isoDate(now)} (${isoWeek(now)})`, '', ...[...bySection].flatMap(([sec, lines]) => [`### ${sec}`, ...lines, ''])].join('\n')
    const count = taken.reduce((n, t) => n + t.lines.filter((l) => /^\s*[-*] \[x\]/i.test(l)).length, 0)
    this.write(rel, `${archive.trimEnd()}\n\n${block}`, `archive ${count} done task${count === 1 ? '' : 's'}`)
    this.write(TODOS_FILE, rest, `archive ${count} done task${count === 1 ? '' : 's'}`)
    return count
  }

  clearHolds(now: Date) {
    for (const [week, data] of Object.entries(this.weeks())) {
      if (!data.overrides?.holds?.some((h) => new Date(h.end) > now)) continue
      this.updateWeek(week, (w) => (w.overrides = { ...w.overrides, holds: (w.overrides?.holds ?? []).filter((h) => new Date(h.end) <= now) }), 'release held time')
    }
  }

  // --- preferences ---------------------------------------------------------
  savePreferences(prefs: Preferences) {
    this.write(PREFERENCES_FILE, serializePreferences(prefs, this.read(PREFERENCES_FILE) ?? undefined), 'update planner preferences')
  }

  // --- brief ---------------------------------------------------------------
  /** The Codex brief for a date (if written) plus active task notes in 05_Tasks/. */
  brief(date: string): BriefData {
    const path = `05_Tasks/briefs/${date}.md`
    const text = this.read(path)
    const sections: { title: string; body: string }[] = []
    if (text) {
      const parts = text.split(/^##\s+/m).slice(1)
      for (const part of parts) {
        const nl = part.indexOf('\n')
        const title = (nl < 0 ? part : part.slice(0, nl)).replace(/^\d+\.\s*/, '').trim()
        sections.push({ title, body: nl < 0 ? '' : part.slice(nl + 1).trim() })
      }
    }
    const skip = new Set(['daily-todos.md', 'braindump-inbox.md', 'README.md', 'recordings-checked.md'])
    const notes: TaskNote[] = []
    const dir = this.abs('05_Tasks')
    if (existsSync(dir)) {
      for (const f of readdirSync(dir).sort()) {
        if (!f.endsWith('.md') || skip.has(f)) continue
        const t = readFileSync(join(dir, f), 'utf8')
        const status = t.match(/^Status:\s*(.+)$/im)?.[1]?.trim()
        if (status && /^(done|archived|completed|inactive)/i.test(status)) continue
        const nextBlock = t.match(/^##\s*Next actions?\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/im)?.[1] ?? ''
        notes.push({
          path: `05_Tasks/${f}`,
          title: t.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? basename(f, '.md'),
          status,
          updated: t.match(/^Last updated:\s*(\S+)/im)?.[1],
          next: nextBlock
            .split('\n')
            .filter((l) => !/^\s*[-*]\s+\[[xX]\]/.test(l))
            .map((l) => l.match(/^\s*[-*]\s+(?:\[ \]\s*)?(.+)$/)?.[1]?.trim())
            .filter((x): x is string => Boolean(x))
            .slice(0, 3)
        })
      }
    }
    return { date, codex: text ? { path, sections } : null, notes }
  }

  writeBrief(date: string, markdown: string) {
    const at = new Date().toTimeString().slice(0, 5)
    this.write(`05_Tasks/briefs/${date}.md`, `# Daily Brief ${date}\n\nGenerated by AI Center at ${at} (read-only run).\n\n${markdown}\n`, `daily brief ${date}`)
  }

  /** The user's brief instructions (06_Prompts/daily-brief.md); null means use the built-in default. */
  readBriefPrompt(): string | null {
    const text = this.read(BRIEF_PROMPT_FILE)
    return text?.trim() ? text : null
  }

  writeBriefPrompt(text: string) {
    this.write(BRIEF_PROMPT_FILE, text.endsWith('\n') ? text : `${text}\n`, 'update daily brief prompt')
  }

  // --- docs ----------------------------------------------------------------
  listDocs(): DocInfo[] {
    const out: DocInfo[] = []
    for (const [dir, group] of DOC_GROUPS) {
      const abs = this.abs(dir)
      if (!existsSync(abs)) continue
      for (const f of readdirSync(abs).sort()) {
        if (!f.endsWith('.md')) continue
        const rel = `${dir}/${f}`
        const text = readFileSync(join(abs, f), 'utf8')
        const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? basename(f, '.md')
        out.push({ path: rel, title, group })
      }
    }
    return out
  }

  readDoc(rel: string): DocContent {
    if (!rel.endsWith('.md')) throw new Error('Only Markdown files can be opened.')
    const content = this.read(rel)
    if (content === null) throw new Error(`${rel} not found.`)
    return { path: rel, content, hash: sha(content) }
  }

  writeDoc(rel: string, content: string, baseHash: string): DocContent {
    const current = this.read(rel)
    if (current !== null && sha(current) !== baseHash) {
      const err = new Error('This file changed on disk since you opened it. Reload to see the latest version.')
      err.name = 'Conflict'
      throw err
    }
    const stamped = stampLastUpdated(content, new Date())
    this.write(rel, stamped, `edit ${rel}`)
    return { path: rel, content: stamped, hash: sha(stamped) }
  }

  // --- watching ------------------------------------------------------------
  startWatching() {
    this.watcher = watch(this.root, {
      ignored: (p) => /(^|\/)(\.git|node_modules|\.DS_Store|\.obsidian)(\/|$)/.test(p),
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
    })
    this.watcher.on('all', (_ev, path) => {
      if (!path.endsWith('.md')) return
      const own = this.ownWrites.get(path)
      if (own !== undefined) {
        this.ownWrites.delete(path)
        if (existsSync(path) && readFileSync(path, 'utf8') === own) return
      }
      if (this.changeTimer) clearTimeout(this.changeTimer)
      this.changeTimer = setTimeout(this.onChange, 200)
    })
  }

  async close() {
    await this.watcher?.close()
    await this.git.flush()
  }
}
