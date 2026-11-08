import type { CalEvent, CalendarInfo } from '@shared/types'

export interface EventInput {
  title: string
  start: string
  end: string
  description?: string
}

/** A calendar backend: macOS Calendar (default) or Google Calendar directly. */
export interface CalendarProvider {
  readonly kind: 'macos' | 'google'
  readonly configured: boolean
  readonly connected: boolean
  connect(): Promise<void>
  disconnect(): void
  calendars(): Promise<CalendarInfo[]>
  events(calendars: CalendarInfo[], from: Date, to: Date): Promise<CalEvent[]>
  /** Creates a planner-tagged event; returns its id when known. */
  insert(calendarId: string, blockId: string, ev: EventInput): Promise<string | undefined>
  /** Only planner-tagged events may be patched or removed. */
  patch(calendarId: string, eventId: string, ev: EventInput, blockId?: string): Promise<void>
  remove(calendarId: string, eventId: string): Promise<void>
}
