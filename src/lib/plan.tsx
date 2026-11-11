import type { AppState } from '@shared/api'
import type { Block, CalEvent, LogEntry, Pin, Task } from '@shared/types'
import { diffMin, isoWeek, localISO } from '@shared/time'
import type { GridItem } from '@/components/TimeGrid'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { calendarColor, categoryOf, plainTitle } from './util'

/** Block kinds a task can be dropped into (not breaks, training or plain calendar events). */
export const ACCEPTS_TASKS = new Set<Block['kind']>(['container', 'proposed', 'topup', 'pinned'])
/** Kinds the user can remove from the plan (Remove block / Delete key). */
export const REMOVABLE = new Set<Block['kind']>(['container', 'proposed', 'topup', 'pinned'])

export const eventKey =(e: CalEvent) => `ev:${e.calendarId}:${e.id}`

/** Why the user can't edit this event in the app, or null if they can (mirrors Controller.editableEvent). */
export function eventLock(state: AppState, e: CalEvent): string | null {
  if (e.plannerBlockId) return 'Planner event: change it through its block.'
  if (state.vault.preferences.protectedCalendars.some((p) => e.calendarName.toLowerCase().startsWith(p.toLowerCase()))) return `${e.calendarName} is protected: the app never changes it.`
  if (state.calendar.calendars.find((c) => c.id === e.calendarId)?.writable === false) return `${e.calendarName} is read-only.`
  return null
}

/** Effective busy/free for the planner: per-event override, else the calendar's own flag or a "free" (ignored) calendar. Mirrors scheduler/plan.ts. */
export function eventAvailability(state: AppState, e: CalEvent): { value: 'busy' | 'free'; overridden: boolean } {
  const o = state.settings.eventAvailability?.[`${e.calendarId}:${e.id}`]
  if (o) return { value: o, overridden: true }
  return { value: e.free || state.vault.preferences.ignoreCalendars.includes(e.calendarName) ? 'free' : 'busy', overridden: false }
}

export function logFor(state: AppState, block: { id: string; start: string }): LogEntry | undefined {
  return state.vault.weeks[isoWeek(new Date(block.start))]?.log.find((l) => l.blockId === block.id)
}

/** A synced block has a planner-tagged event at the same time. */
export function isSynced(state: AppState, b: Block) {
  const ev = state.events.find((e) => e.plannerBlockId === b.id)
  return Boolean(ev && new Date(ev.start).getTime() === new Date(b.start).getTime() && new Date(ev.end).getTime() === new Date(b.end).getTime())
}

export function blockTitle(b: Block) {
  return b.title
}

export function gridItems(state: AppState, days: string[]): { items: GridItem[]; allDay: { day: string; title: string; color: string }[] } {
  const inDays = (s: string, e: string) => days.some((d) => s.slice(0, 10) <= d && e.slice(0, 10) >= d)
  const blockEventIds = new Set(state.plan.blocks.filter((b) => b.eventId).map((b) => b.eventId))
  const taskTitle = new Map(state.vault.tasks.map((t) => [t.id, plainTitle(t)]))
  const hidden = new Set(state.settings.hiddenCalendars ?? [])
  const items: GridItem[] = []
  const allDay: { day: string; title: string; color: string }[] = []

  for (const e of state.events) {
    if (blockEventIds.has(e.id) || e.plannerBlockId || hidden.has(e.calendarName)) continue
    const color = calendarColor(state, e.calendarName) ?? '#94a3b8'
    if (e.allDay) {
      for (const d of days) if (e.start.slice(0, 10) <= d && e.end.slice(0, 10) > d) allDay.push({ day: d, title: e.title, color })
      continue
    }
    if (!inDays(e.start, e.end)) continue
    const free = eventAvailability(state, e).value === 'free'
    // Draggable only by hand (TimeGrid onMove → editEvent); nothing else moves the user's events.
    items.push({ id: eventKey(e), start: e.start, end: e.end, title: e.title, subtitle: free ? `${e.calendarName} · free` : e.calendarName, color, look: free ? 'dashed' : 'outline', dim: free, draggable: !eventLock(state, e) })
  }

  for (const b of state.plan.blocks) {
    if (!inDays(b.start, b.end)) continue
    if (b.kind === 'break') {
      items.push({ id: b.id, start: b.start, end: b.end, title: b.title, color: '#94a3b8', look: 'dashed', dim: true })
      continue
    }
    const cat = categoryOf(state, b.category)
    const logged = logFor(state, b)
    const tasks = b.chunks.map((c) => taskTitle.get(c.taskId)).filter(Boolean)
    items.push({
      id: b.id,
      start: b.start,
      end: b.end,
      title: blockTitle(b),
      subtitle: tasks.length ? tasks.join(' · ') : b.kind === 'topup' ? `Reserved for ${cat.label.toLowerCase()} budget` : undefined,
      color: cat.color,
      look: b.kind === 'container' || b.kind === 'pinned' || isSynced(state, b) ? 'solid' : 'dashed',
      draggable: b.kind !== 'container' && !logged,
      acceptsTasks: ACCEPTS_TASKS.has(b.kind) && !logged && new Date(b.end).getTime() > Date.now(),
      dim: Boolean(logged),
      badge: logged ? <span className="text-[10px] text-ok font-semibold">{logged.status === 'skipped' ? 'skip' : '✓'}</span> : undefined
    })
  }
  // Time kept empty after a removal, so the user sees why nothing is planned there.
  for (const h of heldSlots(state)) {
    if (!inDays(h.start, h.end) || new Date(h.end).getTime() <= Date.now()) continue
    items.push({ id: holdKey(h), start: h.start, end: h.end, title: 'Kept free', subtitle: 'Until you Re-plan', color: '#94a3b8', look: 'dashed', dim: true })
  }
  return { items, allDay }
}

export const holdKey = (h: { start: string; end: string }) => `hold:${h.start}|${h.end}`
export const heldSlots = (state: AppState) => Object.values(state.vault.weeks).flatMap((w) => w.overrides?.holds ?? [])

export function pinFromBlock(b: Block, start: string, end: string): Pin {
  return { blockId: b.id, category: b.category, title: b.title, start, end, taskIds: b.chunks.map((c) => c.taskId), ...(b.fill ? { fill: true } : {}) }
}

export function pinForTask(state: AppState, taskId: string, start: string): Pin | null {
  const t = state.vault.tasks.find((x) => x.id === taskId)
  if (!t) return null
  const cat = categoryOf(state, t.category)
  const minutes = Math.max(30, Math.ceil((t.estimateMin ?? cat.defaultEstimateMinutes) / 15) * 15)
  const end = localISO(new Date(new Date(start).getTime() + minutes * 60_000))
  return { blockId: `pin:${Date.now().toString(36)}`, category: t.category, title: cat.containers[0] ?? cat.label, start, end, taskIds: [t.id] }
}

export const blockMinutes = (b: { start: string; end: string }) => diffMin(b.start, b.end)

/** A hand drag of a calendar event on the grid: moved in the calendar itself, with Undo. Returns false if the id isn't an event. */
export async function moveEvent(state: AppState, id: string, start: string, end: string): Promise<boolean> {
  const ev = state.events.find((e) => eventKey(e) === id)
  if (!ev) return false
  const newId = await act(api.editEvent(ev.calendarId, ev.id, { start, end }))
  if (typeof newId !== 'string') return true
  useStore.getState().toast(`Moved “${ev.title}” in ${ev.calendarName}`, 'info', {
    label: 'Undo',
    run: () => void act(api.editEvent(ev.calendarId, newId, { start: ev.start, end: ev.end }), 'Move undone')
  })
  return true
}

/**
 * Where a set of tasks stands in the current plan (Motion-style ETA): when its last planned chunk
 * ends, how many open tasks would finish after their deadline, and how many aren't planned at all.
 */
export function projection(state: AppState, tasks: Task[]) {
  const openIds = new Set(state.vault.tasks.filter((t) => !t.done).map((t) => t.id))
  const leaves = tasks.filter((t) => !t.done && !t.childIds.some((id) => openIds.has(id)))
  let finish: string | null = null
  let late = 0
  let unplanned = 0
  for (const t of leaves) {
    const f = state.plan.taskFinish[t.id]
    if (!f) {
      unplanned++
      continue
    }
    if (!finish || f > finish) finish = f
    if (t.due && f.slice(0, 10) > t.due) late++
  }
  return { finish, late, unplanned, open: leaves.length }
}
