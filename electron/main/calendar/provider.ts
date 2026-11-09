import type { CalEvent, CalendarInfo } from '@shared/types'

/** A change the user made by hand in the app to one of their own events (one occurrence). */
export interface UserEventChange {
  title?: string
  start?: string
  end?: string
}

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
  /**
   * The only way to change events the planner didn't create. Called solely from an explicit edit in the
   * app (Controller.editEvent / deleteEvent), never from Sync. Refuses planner events.
   */
  /** Returns the event's id afterwards (macOS ids include the occurrence start, so a move changes it). */
  userUpdate(calendarId: string, eventId: string, change: UserEventChange): Promise<string>
  userRemove(calendarId: string, eventId: string): Promise<void>
}
