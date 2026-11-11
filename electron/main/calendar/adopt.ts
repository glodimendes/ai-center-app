import type { CalEvent } from '@shared/types'

export interface SyncedBlock {
  eventId?: string
  calendarId: string
  start: string
  end: string
}

export interface CalendarEdits {
  /** Deleted in the calendar while still ahead: dismiss the block and keep its time free. */
  deleted: { blockId: string; start: string; end: string }[]
  /** Moved or resized in the calendar: pin the block at the event's time. */
  moved: { blockId: string; event: CalEvent }[]
  /** No longer tracked as synced (deleted, ahead or not). */
  forget: string[]
}

/**
 * Your calendar edits win over the plan: compares what was synced with what the calendar shows now.
 * Only calendars that actually loaded count: an account that is offline or briefly gone hides its
 * events without anyone deleting them.
 */
export function calendarEdits(synced: Record<string, SyncedBlock>, events: CalEvent[], from: Date, loadedCalendarIds: string[], now: Date): CalendarEdits {
  const out: CalendarEdits = { deleted: [], moved: [], forget: [] }
  const same = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime()
  for (const [blockId, s] of Object.entries(synced)) {
    if (new Date(s.start) < from) continue
    const ev = events.find((e) => e.plannerBlockId === blockId)
    if (!ev) {
      if (!loadedCalendarIds.includes(s.calendarId)) continue
      if (new Date(s.end) > now) out.deleted.push({ blockId, start: s.start, end: s.end })
      out.forget.push(blockId)
      continue
    }
    if (!same(ev.start, s.start) || !same(ev.end, s.end)) out.moved.push({ blockId, event: ev })
  }
  return out
}
