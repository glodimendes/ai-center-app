import { app, safeStorage, shell } from 'electron'
import { createServer } from 'node:http'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { google, type calendar_v3 } from 'googleapis'
import type { Auth } from 'googleapis'
import type { CalEvent, CalendarInfo } from '@shared/types'
import type { CalendarProvider } from './provider'

const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly']
export const PLANNER_TAG = 'aiCenterPlanner'
const tokenFile = () => join(app.getPath('userData'), 'google-tokens.bin')
export const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

function saveTokens(tokens: Auth.Credentials) {
  const json = JSON.stringify(tokens)
  writeFileSync(tokenFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json))
}

function loadTokens(): Auth.Credentials | null {
  if (!existsSync(tokenFile())) return null
  const buf = readFileSync(tokenFile())
  try {
    return JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString())
  } catch {
    return null
  }
}

export class GoogleCalendar implements CalendarProvider {
  readonly kind = 'google' as const
  private client: Auth.OAuth2Client | null = null
  private api: calendar_v3.Calendar | null = null

  constructor(
    private clientId?: string,
    private clientSecret?: string
  ) {
    this.restore()
  }

  get configured() {
    return Boolean(this.clientId && this.clientSecret)
  }

  get connected() {
    return this.api !== null
  }

  configure(clientId: string, clientSecret: string) {
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.restore()
  }

  private makeClient(redirect = 'http://127.0.0.1') {
    const c = new google.auth.OAuth2(this.clientId, this.clientSecret, redirect)
    c.on('tokens', (t) => saveTokens({ ...c.credentials, ...t }))
    return c
  }

  private restore() {
    const tokens = this.configured ? loadTokens() : null
    if (!tokens) {
      this.client = this.api = null
      return
    }
    this.client = this.makeClient()
    this.client.setCredentials(tokens)
    this.api = google.calendar({ version: 'v3', auth: this.client })
  }

  /** Loopback OAuth: a one-shot local listener only for the duration of sign-in. */
  async connect(): Promise<void> {
    if (!this.configured) throw new Error('Add your Google OAuth client ID and secret in Settings first.')
    const server = createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    const client = this.makeClient(`http://127.0.0.1:${port}`)
    const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES })
    const code = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Sign-in timed out.')), 5 * 60_000)
      server.on('request', (req, res) => {
        const u = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
        const code = u.searchParams.get('code')
        const error = u.searchParams.get('error')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<body style="font-family:system-ui;padding:40px">${code ? 'Connected. You can close this tab and return to AI Center.' : `Sign-in failed: ${error ?? 'unknown error'}`}</body>`)
        clearTimeout(timeout)
        if (code) resolve(code)
        else reject(new Error(error ?? 'Sign-in failed.'))
      })
      void shell.openExternal(url)
    }).finally(() => server.close())
    const { tokens } = await client.getToken(code)
    client.setCredentials(tokens)
    saveTokens(tokens)
    this.client = client
    this.api = google.calendar({ version: 'v3', auth: client })
  }

  disconnect() {
    if (existsSync(tokenFile())) rmSync(tokenFile())
    this.client = this.api = null
  }

  private need() {
    if (!this.api) throw new Error('Google Calendar is not connected.')
    return this.api
  }

  async calendars(): Promise<CalendarInfo[]> {
    const res = await this.need().calendarList.list({ maxResults: 250 })
    return (res.data.items ?? []).map((c) => ({
      id: c.id!,
      name: c.summaryOverride ?? c.summary ?? c.id!,
      color: c.backgroundColor ?? '#94a3b8',
      writable: c.accessRole === 'owner' || c.accessRole === 'writer',
      primary: c.primary ?? false
    }))
  }

  async events(calendars: CalendarInfo[], timeMin: Date, timeMax: Date): Promise<CalEvent[]> {
    const api = this.need()
    const lists = await Promise.all(
      calendars.map(async (cal) => {
        const items: calendar_v3.Schema$Event[] = []
        let pageToken: string | undefined
        do {
          const res = await api.events.list({
            calendarId: cal.id,
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 2500,
            pageToken
          })
          items.push(...(res.data.items ?? []))
          pageToken = res.data.nextPageToken ?? undefined
        } while (pageToken)
        return items
          .filter((e) => e.status !== 'cancelled' && (e.start?.dateTime || e.start?.date))
          .map(
            (e): CalEvent => ({
              id: e.id!,
              calendarId: cal.id,
              calendarName: cal.name,
              title: e.summary ?? '(no title)',
              start: e.start!.dateTime ?? `${e.start!.date}T00:00:00`,
              end: e.end?.dateTime ?? `${e.end?.date ?? e.start!.date}T00:00:00`,
              allDay: !e.start!.dateTime,
              description: e.description ?? undefined,
              plannerBlockId: e.extendedProperties?.private?.[PLANNER_TAG],
              free: e.transparency === 'transparent'
            })
          )
      })
    )
    return lists.flat()
  }

  async insert(calendarId: string, blockId: string, ev: { title: string; start: string; end: string; description?: string }) {
    const res = await this.need().events.insert({
      calendarId,
      requestBody: {
        summary: ev.title,
        description: ev.description,
        start: { dateTime: ev.start, timeZone: TIME_ZONE },
        end: { dateTime: ev.end, timeZone: TIME_ZONE },
        extendedProperties: { private: { [PLANNER_TAG]: blockId } }
      }
    })
    return res.data.id ?? undefined
  }

  /** Only events carrying the planner tag may be changed. */
  private async assertOwned(calendarId: string, eventId: string) {
    const res = await this.need().events.get({ calendarId, eventId })
    if (!res.data.extendedProperties?.private?.[PLANNER_TAG]) throw new Error(`Refusing to modify "${res.data.summary}": not created by the planner.`)
  }

  async patch(calendarId: string, eventId: string, ev: { title: string; start: string; end: string; description?: string }) {
    await this.assertOwned(calendarId, eventId)
    await this.need().events.patch({
      calendarId,
      eventId,
      requestBody: {
        summary: ev.title,
        description: ev.description,
        start: { dateTime: ev.start, timeZone: TIME_ZONE },
        end: { dateTime: ev.end, timeZone: TIME_ZONE }
      }
    })
  }

  async remove(calendarId: string, eventId: string) {
    await this.assertOwned(calendarId, eventId)
    await this.need().events.delete({ calendarId, eventId })
  }
}
