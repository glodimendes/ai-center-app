import { createHash } from 'node:crypto'
import type { CategoryPref, InboxItem, Section, Task } from '@shared/types'
import { parseTokens } from './tokens'

export const TASK_RE = /^([\t ]*)([-*+]) \[([ xX])\] ?(.*)$/
export const HEADING_RE = /^[\t ]*(#{1,6})\s+(.+?)\s*#*\s*$/
const FENCE_RE = /^[\t ]*(```|~~~)/

const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12)

export function splitLines(text: string): { lines: string[]; eol: string } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  return { lines: text.split(/\r?\n/), eol }
}

export function indentWidth(ws: string): number {
  let w = 0
  for (const ch of ws) w += ch === '\t' ? 4 : 1
  return w
}

export function resolveCategory(section: string[], categories: CategoryPref[]): string {
  for (let i = section.length - 1; i >= 0; i--) {
    const h = section[i].toLowerCase()
    for (const c of categories) {
      if (c.headings.some((needle) => h.includes(needle.toLowerCase()))) return c.key
    }
  }
  return 'other'
}

interface HeadingState {
  levels: { level: number; text: string }[]
}

function pushHeading(state: HeadingState, level: number, text: string) {
  while (state.levels.length && state.levels[state.levels.length - 1].level >= level) state.levels.pop()
  state.levels.push({ level, text })
}

/** Heading path below the document title (h1 is dropped). */
const sectionPath = (state: HeadingState) => state.levels.filter((l) => l.level > 1).map((l) => l.text)

export function parseTasks(
  text: string,
  file: string,
  categories: CategoryPref[],
  today: Date
): { tasks: Task[]; sections: Section[] } {
  const { lines } = splitLines(text)
  const tasks: Task[] = []
  const sections: Section[] = []
  const state: HeadingState = { levels: [] }
  const seen = new Map<string, number>()
  const stack: { width: number; task: Task }[] = []
  let current: Section | null = null
  let inFence = false

  lines.forEach((line, i) => {
    if (FENCE_RE.test(line)) inFence = !inFence
    if (inFence) return

    const h = line.match(HEADING_RE)
    if (h && !TASK_RE.test(line)) {
      pushHeading(state, h[1].length, h[2].trim())
      stack.length = 0
      const path = sectionPath(state)
      current = path.length ? { path, category: resolveCategory(path, categories), taskIds: [] } : null
      if (current) sections.push(current)
      return
    }

    const m = line.match(TASK_RE)
    if (!m) {
      // A non-indented, non-blank line ends any nesting.
      if (line.trim() && !/^[\t ]/.test(line)) stack.length = 0
      return
    }
    const width = indentWidth(m[1])
    const path = sectionPath(state)
    const tokens = parseTokens(m[4], today)
    const key = `${file}|${path.join('>')}|${tokens.title.toLowerCase()}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)

    while (stack.length && stack[stack.length - 1].width >= width) stack.pop()
    const parent = stack[stack.length - 1]?.task

    const task: Task = {
      id: hash(`${key}#${n}`),
      file,
      line: i,
      indent: width,
      title: tokens.title,
      done: m[3] !== ' ',
      section: path,
      category: resolveCategory(path, categories),
      estimateMin: tokens.estimateMin,
      due: tokens.due,
      dueStyle: tokens.dueStyle,
      priority: tokens.priority ?? 'medium',
      parentId: parent?.id,
      childIds: []
    }
    parent?.childIds.push(task.id)
    tasks.push(task)
    stack.push({ width, task })
    const sec = current as Section | null
    if (sec && !parent) sec.taskIds.push(task.id)
  })

  return { tasks, sections }
}

/**
 * Inbox entries: plain list items under dated `## YYYY-MM-DD` headings.
 * Sections whose heading is not a date (e.g. "Routing Notes") are ignored.
 */
export function parseInbox(text: string, file: string): InboxItem[] {
  const { lines } = splitLines(text)
  const items: InboxItem[] = []
  let date: string | undefined
  let topic: string | undefined
  const seen = new Map<string, number>()
  lines.forEach((line, i) => {
    const h = line.match(HEADING_RE)
    if (h) {
      const level = h[1].length
      if (level === 2) {
        date = /^\d{4}-\d{2}-\d{2}$/.test(h[2].trim()) ? h[2].trim() : undefined
        topic = undefined
      } else if (level >= 3) topic = h[2].trim()
      return
    }
    if (!date) return
    const m = line.match(/^[-*+] (?!\[[ xX]\])(.+)$/)
    if (!m) return
    const key = `${file}|${date}|${m[1]}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    items.push({ id: hash(`${key}#${n}`), line: i, text: m[1].trim(), date, topic })
  })
  return items
}
