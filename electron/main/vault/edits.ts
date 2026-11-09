import type { CategoryPref, TaskPatch } from '@shared/types'
import { HEADING_RE, TASK_RE, parseInbox, parseTasks, splitLines } from './parser'
import { nextOccurrence } from '@shared/repeat'
import { editTokens, isoDate } from './tokens'

// Pure text transforms. Each one re-parses the current file text, locates its target
// by stable id, and changes only the lines it must. Everything else stays byte-identical.

export class TargetMissingError extends Error {}

export function patchTask(
  text: string,
  file: string,
  taskId: string,
  patch: TaskPatch,
  categories: CategoryPref[],
  today: Date
): string {
  const { tasks } = parseTasks(text, file, categories, today)
  const task = tasks.find((t) => t.id === taskId)
  if (!task) throw new TargetMissingError('That task changed or was removed in the file. Reloaded the latest version.')
  const { lines, eol } = splitLines(text)
  const m = lines[task.line].match(TASK_RE)!
  const [, ws, marker, state, body] = m
  const nextState = patch.done === undefined ? state : patch.done ? 'x' : ' '
  const { done: _done, ...tokenEdit } = patch
  const nextBody = Object.keys(tokenEdit).length ? editTokens(body, tokenEdit, today) : body
  lines[task.line] = `${ws}${marker} [${nextState}] ${nextBody}`
  // Checking off a repeating task: the next occurrence goes above it, so the open task keeps its id.
  const next = patch.done && state === ' ' && task.repeat ? nextOccurrence(task.repeat, task.due, today) : null
  if (next) lines.splice(task.line, 0, `${ws}${marker} [ ] ${editTokens(nextBody, { due: next, postponed: null }, today)}`)
  return lines.join(eol)
}

/** Region of a section: from its heading line to the line before the next heading. */
function findSection(lines: string[], path: string[]): { heading: number; end: number } | null {
  const stack: { level: number; text: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(HEADING_RE)
    if (!h || TASK_RE.test(lines[i])) continue
    const level = h[1].length
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
    stack.push({ level, text: h[2].trim() })
    const p = stack.filter((s) => s.level > 1).map((s) => s.text)
    if (p.length === path.length && p.every((t, j) => t === path[j])) {
      let end = lines.length
      for (let j = i + 1; j < lines.length; j++) {
        if (HEADING_RE.test(lines[j]) && !TASK_RE.test(lines[j])) {
          end = j
          break
        }
      }
      return { heading: i, end }
    }
  }
  return null
}

export function insertTask(text: string, sectionPath: string[], body: string): string {
  const { lines, eol } = splitLines(text)
  const sec = findSection(lines, sectionPath)
  if (!sec) throw new TargetMissingError(`Section "${sectionPath.join(' › ')}" not found.`)
  let at = sec.heading + 1
  for (let i = sec.end - 1; i > sec.heading; i--) {
    if (lines[i].trim()) {
      at = i + 1
      break
    }
  }
  lines.splice(at, 0, `- [ ] ${body.trim()}`)
  return lines.join(eol)
}

export function deleteTask(text: string, file: string, taskId: string, categories: CategoryPref[], today: Date): string {
  const { tasks } = parseTasks(text, file, categories, today)
  const task = tasks.find((t) => t.id === taskId)
  if (!task) throw new TargetMissingError('That task changed or was removed in the file.')
  const { lines, eol } = splitLines(text)
  // Remove the task and its nested children.
  let end = task.line + 1
  while (end < lines.length) {
    const m = lines[end].match(/^([\t ]*)\S/)
    const width = m ? m[1].replace(/\t/g, '    ').length : Infinity
    if (lines[end].trim() && width > task.indent) end++
    else break
  }
  lines.splice(task.line, end - task.line)
  return lines.join(eol)
}

/** End (exclusive) of a task's subtree: the following lines indented deeper than it. */
function subtreeEnd(lines: string[], line: number, indent: number): number {
  let end = line + 1
  while (end < lines.length) {
    const m = lines[end].match(/^([\t ]*)\S/)
    const width = m ? m[1].replace(/\t/g, '    ').length : Infinity
    if (lines[end].trim() && width > indent) end++
    else break
  }
  return end
}

/** One indentation step as the file already uses it (the vault uses tabs). */
function indentUnit(lines: string[]): string {
  const ws = lines.map((l) => l.match(TASK_RE)?.[1]).find((w) => w)
  return !ws || ws.startsWith('\t') ? '\t' : ' '.repeat(Math.min(ws.length, 4))
}

const reindent = (lines: string[], from: string, to: string) =>
  lines.map((l) => {
    if (!l.trim()) return l
    if (!l.startsWith(from)) throw new TargetMissingError('Mixed indentation under this task; change it in the file instead.')
    return to + l.slice(from.length)
  })

/**
 * Make a task a subtask of the task above it ('in'), or lift it out of its parent ('out', placed
 * after the parent's subtree so later siblings stay where they are). Its own subtasks move with it.
 * Only the task's lines (and, for 'out', the siblings it passes) change.
 */
export function indentTask(text: string, file: string, taskId: string, dir: 'in' | 'out', categories: CategoryPref[], today: Date): string {
  const { tasks } = parseTasks(text, file, categories, today)
  const task = tasks.find((t) => t.id === taskId)
  if (!task) throw new TargetMissingError('That task changed or was removed in the file.')
  const { lines, eol } = splitLines(text)
  const ws = lines[task.line].match(TASK_RE)![1]
  const end = subtreeEnd(lines, task.line, task.indent)
  const block = lines.slice(task.line, end)
  let out: string[]
  let parentAfter: string | undefined
  if (dir === 'in') {
    const siblings = tasks.filter((t) => t.parentId === task.parentId && t.section.join('>') === task.section.join('>') && t.line < task.line)
    const prev = siblings[siblings.length - 1]
    if (!prev) throw new TargetMissingError('There is no task above it at the same level to put it under.')
    const prevWs = lines[prev.line].match(TASK_RE)![1]
    const firstChild = tasks.find((t) => t.parentId === prev.id)
    const childWs = firstChild ? lines[firstChild.line].match(TASK_RE)![1] : prevWs + indentUnit(lines)
    out = [...lines.slice(0, task.line), ...reindent(block, ws, childWs), ...lines.slice(end)]
    parentAfter = prev.id
  } else {
    const parent = tasks.find((t) => t.id === task.parentId)
    if (!parent) throw new TargetMissingError('It is already a top-level task.')
    const parentWs = lines[parent.line].match(TASK_RE)![1]
    const pEnd = subtreeEnd(lines, parent.line, parent.indent)
    out = [...lines.slice(0, task.line), ...lines.slice(end, pEnd), ...reindent(block, ws, parentWs), ...lines.slice(pEnd)]
    parentAfter = parent.parentId
  }
  const next = out.join(eol)
  // A paragraph or heading in between would break the nesting Obsidian shows; refuse rather than guess.
  const moved = parseTasks(next, file, categories, today).tasks.find((t) => t.id === task.id)
  if (!moved || moved.parentId !== parentAfter) throw new TargetMissingError("Can't nest it there; edit the file instead.")
  return next
}

/** New open subtask at the end of a task's subtasks. */
export function addSubtask(text: string, file: string, parentId: string, body: string, categories: CategoryPref[], today: Date): string {
  const { tasks } = parseTasks(text, file, categories, today)
  const parent = tasks.find((t) => t.id === parentId)
  if (!parent) throw new TargetMissingError('That task changed or was removed in the file.')
  const { lines, eol } = splitLines(text)
  const [, ws, marker] = lines[parent.line].match(TASK_RE)!
  const firstChild = tasks.find((t) => t.parentId === parent.id)
  const childWs = firstChild ? lines[firstChild.line].match(TASK_RE)![1] : ws + indentUnit(lines)
  lines.splice(subtreeEnd(lines, parent.line, parent.indent), 0, `${childWs}${marker} [ ] ${body.trim()}`)
  return lines.join(eol)
}

export function addInboxItem(text: string, entry: string, today: Date): string {
  const { lines, eol } = splitLines(text)
  const date = isoDate(today)
  const headingIdx = lines.findIndex((l) => l.trim() === `## ${date}`)
  const stamp = lines.findIndex((l) => /^Last updated:/i.test(l))
  if (stamp >= 0) lines[stamp] = `Last updated: ${date}`
  if (headingIdx >= 0) {
    let at = headingIdx + 1
    for (let i = headingIdx + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) break
      if (lines[i].trim()) at = i + 1
    }
    lines.splice(at, 0, `- ${entry.trim()}`)
    return lines.join(eol)
  }
  // New dated section goes before "## Routing Notes" (or at the end).
  let at = lines.findIndex((l) => /^##\s+Routing Notes/i.test(l))
  if (at < 0) at = lines.length
  while (at > 0 && !lines[at - 1].trim()) at--
  lines.splice(at, 0, '', `## ${date}`, '', `- ${entry.trim()}`)
  return lines.join(eol)
}

export function removeInboxItem(text: string, file: string, itemId: string): string {
  const item = parseInbox(text, file).find((i) => i.id === itemId)
  if (!item) throw new TargetMissingError('That inbox item changed or was removed.')
  const { lines, eol } = splitLines(text)
  lines.splice(item.line, 1)
  return lines.join(eol)
}

/** Replace a `Last updated: …` line with today's date, if the doc has one. */
export function stampLastUpdated(text: string, today: Date): string {
  return text.replace(/^(Last updated:\s*)\d{4}-\d{2}-\d{2}/m, `$1${isoDate(today)}`)
}
