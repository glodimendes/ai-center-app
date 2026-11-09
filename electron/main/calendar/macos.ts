import { app } from 'electron'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import type { CalEvent, CalendarInfo } from '@shared/types'
import type { CalendarProvider, EventInput } from './provider'

const TAG_RE = /\n?\[planner:([^\]]+)\]\s*$/

/** The bundled Swift helper (native/calendar-helper) talks to macOS Calendar via EventKit. */
const helperPath = () => (app.isPackaged ? join(process.resourcesPath, 'calendar-helper') : join(app.getAppPath(), 'resources/calendar-helper'))

function helper<T>(args: string[], input?: object): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = execFile(helperPath(), args, { maxBuffer: 32 * 1024 * 1024, timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr.trim() || err.message))
      try {
        resolve(JSON.parse(stdout) as T)
      } catch {
        reject(new Error('Unexpected output from the calendar helper.'))
      }
    })
    if (input) child.stdin?.end(JSON.stringify(input))
    else child.stdin?.end()
  })
}

/**
 * macOS Calendar: every account added in System Settings → Internet Accounts (your Google calendars
 * included) without a Google Cloud project. Planner events are marked by a tag line in their notes.
 */
export class MacCalendar implements CalendarProvider {
  readonly kind = 'macos' as const
  readonly configured = true
  private status = 'notDetermined'

  get connected() {
    return this.status === 'fullAccess'
  }

  async check() {
    this.status = (await helper<{ status: string }>(['status'])).status
    return this.status
  }

  async connect() {
    this.status = (await helper<{ status: string }>(['request'])).status
    if (!this.connected) throw new Error(`Calendar access is "${this.status}". Allow AI Center in System Settings → Privacy & Security → Calendars, then try again.`)
  }

  disconnect() {
    this.status = 'disabled'
  }

  async calendars(): Promise<CalendarInfo[]> {
    const list = await helper<{ id: string; name: string; color: string; writable: boolean; source: string }[]>(['calendars'])
    return list.map((c) => ({ id: c.id, name: c.name, color: c.color, writable: c.writable, source: c.source }))
  }

  async events(calendars: CalendarInfo[], from: Date, to: Date): Promise<CalEvent[]> {
    const ids = new Set(calendars.map((c) => c.id))
    const raw = await helper<{ id: string; calendarId: string; calendarName: string; title: string; start: string; end: string; allDay: boolean; notes: string; free?: boolean }[]>([
      'events',
      from.toISOString(),
      to.toISOString()
    ])
    return raw
      .filter((e) => ids.has(e.calendarId))
      .map((e) => {
        const tag = e.notes.match(TAG_RE)
        return {
          id: e.id,
          calendarId: e.calendarId,
          calendarName: e.calendarName,
          title: e.title,
          start: e.start,
          end: e.end,
          allDay: e.allDay,
          description: e.notes.replace(TAG_RE, '') || undefined,
          plannerBlockId: tag?.[1],
          free: e.free === true
        }
      })
  }

  async insert(calendarId: string, blockId: string, ev: EventInput) {
    const r = await helper<{ id: string }>(['create'], { calendarId, title: ev.title, start: ev.start, end: ev.end, notes: `${ev.description ?? ''}\n[planner:${blockId}]` })
    return r.id
  }

  async patch(_calendarId: string, eventId: string, ev: EventInput, blockId?: string) {
    await helper(['update'], { id: eventId, title: ev.title, start: ev.start, end: ev.end, notes: blockId ? `${ev.description ?? ''}\n[planner:${blockId}]` : undefined })
  }

  async remove(_calendarId: string, eventId: string) {
    await helper(['delete', eventId])
  }
}
