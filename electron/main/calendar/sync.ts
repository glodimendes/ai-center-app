import type { Block, CalEvent, CalendarInfo, Preferences, SyncOp, Task } from '@shared/types'
import { addDays, fmtDuration, startOfDay } from '@shared/time'

const SYNCED_KINDS = new Set(['proposed', 'topup', 'training', 'pinned'])
const same = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime()

export function blockDescription(block: Block, tasks: Map<string, Task>): string {
  const lines = block.chunks
    .map((c) => tasks.get(c.taskId))
    .filter((t): t is Task => Boolean(t))
    .map((t) => `• ${t.title.replace(/\*\*/g, '')}${block.chunks.find((c) => c.taskId === t.id)?.minutes ? ` (${fmtDuration(block.chunks.find((c) => c.taskId === t.id)!.minutes)})` : ''}`)
  if (block.trainingSession) lines.unshift(`Session: ${block.trainingSession}`)
  return [...lines, '', 'Planned by AI Center Planner'].join('\n').trim()
}

/**
 * Diff between the planner's blocks and the planner-tagged events in Google Calendar,
 * from the start of today to `syncDays` ahead. Untagged events never appear here.
 */
export function buildSyncDiff(
  blocks: Block[],
  events: CalEvent[],
  calendars: CalendarInfo[],
  prefs: Preferences,
  tasks: Task[],
  now: Date
): { ops: SyncOp[]; problems: string[] } {
  const from = startOfDay(now).getTime()
  const to = addDays(startOfDay(now), prefs.syncDays).getTime()
  const inWindow = (s: string) => {
    const t = new Date(s).getTime()
    return t >= from && t < to
  }
  const byName = new Map(calendars.map((c) => [c.name, c]))
  const taskMap = new Map(tasks.map((t) => [t.id, t]))
  const problems: string[] = []
  const ops: SyncOp[] = []

  const desired = blocks.filter((b) => SYNCED_KINDS.has(b.kind) && inWindow(b.start))
  const existing = new Map(events.filter((e) => e.plannerBlockId && inWindow(e.start)).map((e) => [e.plannerBlockId!, e]))

  for (const b of desired) {
    const cal = byName.get(b.calendarName)
    if (!cal) {
      problems.push(`Calendar "${b.calendarName}" not found for "${b.title}". Check the category's calendar name in preferences.`)
      continue
    }
    if (prefs.protectedCalendars.some((p) => cal.name.toLowerCase().startsWith(p.toLowerCase()))) {
      problems.push(`"${b.title}" targets the protected calendar "${cal.name}". Pick another calendar for this area in Settings.`)
      continue
    }
    if (!cal.writable) {
      problems.push(`Calendar "${b.calendarName}" is read-only.`)
      continue
    }
    const description = blockDescription(b, taskMap)
    const ex = existing.get(b.id)
    existing.delete(b.id)
    const base = { blockId: b.id, title: b.title, start: b.start, end: b.end, calendarName: cal.name, calendarId: cal.id, description }
    if (!ex) {
      ops.push({ op: 'create', ...base })
    } else if (ex.calendarId !== cal.id) {
      ops.push({ op: 'delete', ...base, calendarId: ex.calendarId, calendarName: ex.calendarName, eventId: ex.id, start: ex.start, end: ex.end })
      ops.push({ op: 'create', ...base })
    } else if (!same(ex.start, b.start) || !same(ex.end, b.end) || ex.title !== b.title || (ex.description ?? '') !== description) {
      ops.push({ op: 'update', ...base, eventId: ex.id, previous: { start: ex.start, end: ex.end, title: ex.title } })
    }
  }

  // Leftover planner events: drop those not yet finished; leave the past alone.
  for (const ex of existing.values()) {
    if (new Date(ex.end).getTime() <= now.getTime()) continue
    ops.push({ op: 'delete', blockId: ex.plannerBlockId!, title: ex.title, start: ex.start, end: ex.end, calendarName: ex.calendarName, calendarId: ex.calendarId, eventId: ex.id })
  }
  return { ops, problems }
}
