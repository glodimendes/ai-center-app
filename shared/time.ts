// Local-time helpers shared by main and renderer. Times are minutes since local midnight.

const pad = (n: number) => String(n).padStart(2, '0')

export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function parseDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Local timestamp without offset, e.g. 2026-11-09T08:30:00 (parsed back as local time). */
export const localISO = (d: Date) => `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`

export const toHM =(s: string) => {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + (m || 0)
}

export const fmtHM = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

export const atMinutes = (day: Date, min: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, min)

export const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes()

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/** Monday of the week containing d. */
export function weekStart(d: Date): Date {
  const day = (d.getDay() + 6) % 7
  return addDays(startOfDay(d), -day)
}

/** ISO-8601 week id, e.g. 2026-W46. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${t.getUTCFullYear()}-W${pad(week)}`
}

export const diffMin = (a: string | Date, b: string | Date) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)

export function fmtDuration(min: number): string {
  const sign = min < 0 ? '-' : ''
  const abs = Math.abs(Math.round(min))
  const h = Math.floor(abs / 60)
  const m = abs % 60
  if (!h) return `${sign}${m}m`
  return m ? `${sign}${h}h ${m}m` : `${sign}${h}h`
}
