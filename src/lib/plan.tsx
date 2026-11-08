import type { AppState } from '@shared/api'
import type { Block, CalEvent, LogEntry, Pin } from '@shared/types'
import { diffMin, isoWeek, localISO } from '@shared/time'
import type { GridItem } from '@/components/TimeGrid'
import { calendarColor, categoryOf, plainTitle } from './util'

/** Block kinds a task can be dropped into (not breaks, training or plain calendar events). */
export const ACCEPTS_TASKS = new Set<Block['kind']>(['container', 'proposed', 'topup', 'pinned'])
/** Kinds the user can remove from the plan (Remove block / Delete key). */
export const REMOVABLE = new Set<Block['kind']>(['container', 'proposed', 'topup', 'pinned', 'training'])

export const eventKey =(e: CalEvent) => `ev:${e.calendarId}:${e.id}`

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
  if (b.kind === 'container' && b.trainingSession) return `${b.title} · ${b.trainingSession}`
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
    items.push({ id: eventKey(e), start: e.start, end: e.end, title: e.title, subtitle: free ? `${e.calendarName} · free` : e.calendarName, color, look: free ? 'dashed' : 'outline', dim: free })
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
  return { items, allDay }
}

export function pinFromBlock(b: Block, start: string, end: string): Pin {
  return { blockId: b.id, category: b.category, title: b.title, start, end, taskIds: b.chunks.map((c) => c.taskId) }
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
