import type { Task, WeekData } from '@shared/types'
import { addDays, isoDate, isoWeek, startOfDay, weekStart } from '@shared/time'

/** Session ids look like `<taskId>@2026-W46#2`; everything outside the planner sees `<taskId>`. */
export const baseTaskId = (id: string) => {
  const i = id.indexOf('@')
  return i < 0 ? id : id.slice(0, i)
}

/** Sessions of a habit logged in a week: block logs that list the task, skipped ones excluded. */
export function habitSessionsDone(taskId: string, week: WeekData | undefined): number {
  return (week?.log ?? []).filter((l) => l.status !== 'skipped' && (l.taskIds ?? []).includes(taskId)).length
}

/**
 * A habit (`3x/week`) becomes this week's remaining sessions (and every later week's in the horizon),
 * each a task due at the end of its week and not planned before its slot, so sessions spread over the
 * days left instead of stacking at the start. The planner keeps one session per habit per day.
 */
export function expandHabits(tasks: Task[], weeks: Record<string, WeekData>, now: Date, horizonDays: number): Task[] {
  const today = startOfDay(now)
  const end = addDays(today, horizonDays)
  const out: Task[] = []
  for (const t of tasks) {
    if (!t.perWeek || t.done || t.childIds.length) {
      out.push(t)
      continue
    }
    for (let ws = weekStart(today); ws < end; ws = addDays(ws, 7)) {
      const week = isoWeek(ws)
      const first = ws < today ? today : ws
      const last = addDays(ws, 6)
      const left = t.perWeek - habitSessionsDone(t.id, weeks[week])
      const span = Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1
      for (let i = 0; i < left; i++) {
        const slotDay = addDays(first, Math.floor((i * span) / left))
        // A week cut off by the horizon only gets the sessions that fall inside it (no false "doesn't fit").
        if (slotDay >= end) break
        const slot = isoDate(slotDay)
        const postponed = t.postponed && t.postponed > slot ? t.postponed : slot
        out.push({ ...t, id: `${t.id}@${week}#${i + 1}`, perWeek: undefined, repeat: undefined, due: isoDate(last), dueStyle: 'iso', postponed, childIds: [] })
      }
    }
  }
  return out
}
