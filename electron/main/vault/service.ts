import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import type { DocContent, DocInfo, LogEntry, Pin, Preferences, TaskPatch, VaultState, WeekData } from '@shared/types'
import { isoWeek } from '@shared/time'
import { parseInbox, parseTasks } from './parser'
import { addInboxItem, deleteTask, insertTask, patchTask, removeInboxItem, stampLastUpdated } from './edits'
import { DEFAULT_PREFERENCES, PREFERENCES_FILE, parsePreferences, serializePreferences } from './preferences'
import { TRAINING_FILE, parseTrainingPlan } from './training'
import { WEEKLY_DIR, parseWeekly, serializeWeekly, weeklyFile } from './weekly'
import { VaultGit } from './git'

export const TODOS_FILE = '05_Tasks/daily-todos.md'
export const INBOX_FILE = '05_Tasks/braindump-inbox.md'

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
  readonly git: VaultGit

  constructor(
    readonly root: string,
    autoCommit: () => boolean,
    private onChange: () => void
  ) {
    this.git = new VaultGit(root, autoCommit)
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
    this.git.record(rel, message)
  }

  /** Read-modify-write against the file as it is on disk right now. */
  private update(rel: string, fn: (text: string) => string, message: string) {
    const text = this.read(rel)
    if (text === null) throw new Error(`${rel} not found in the vault.`)
    const next = fn(text)
    if (next !== text) this.write(rel, next, message)
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
    const trainingText = this.read(TRAINING_FILE)
    const training = trainingText ? parseTrainingPlan(trainingText) : null
    if (trainingText && !training) errors.push(`Couldn't read the weekly plan table in ${TRAINING_FILE}.`)
    return {
      vaultPath: this.root,
      tasks,
      sections,
      inbox: inboxText ? parseInbox(inboxText, INBOX_FILE) : [],
      preferences: prefs,
      preferencesFileExists: this.read(PREFERENCES_FILE) !== null,
      training,
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

  // --- preferences ---------------------------------------------------------
  savePreferences(prefs: Preferences) {
    this.write(PREFERENCES_FILE, serializePreferences(prefs, this.read(PREFERENCES_FILE) ?? undefined), 'update planner preferences')
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
      if (this.changeTimer) clearTimeout(this.changeTimer)
      this.changeTimer = setTimeout(this.onChange, 200)
    })
  }

  async close() {
    await this.watcher?.close()
    await this.git.flush()
  }
}
