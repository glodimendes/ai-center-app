import type { Routine } from './agents'

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** Weekdays (0 = Sunday) a routine's `days` text covers, or null when it can't be read. */
export function parseDays(days: string): number[] | null {
  const d = days.trim().toLowerCase()
  if (d === 'daily' || d === 'every day') return [0, 1, 2, 3, 4, 5, 6]
  if (d === 'weekdays') return [1, 2, 3, 4, 5]
  if (d === 'weekends') return [0, 6]
  const out = d.split(/[\s,]+/).filter(Boolean).map((x) => DAY_NAMES.indexOf(x.slice(0, 3)))
  return out.length && out.every((x) => x >= 0) ? [...new Set(out)].sort() : null
}

export function parseTime(time: string): { hour: number; minute: number } | null {
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const [hour, minute] = [Number(m[1]), Number(m[2])]
  return hour < 24 && minute < 60 ? { hour, minute } : null
}

/** Readable rule, e.g. "Weekdays at 07:00". */
export function describeRoutine(r: Pick<Routine, 'time' | 'days'>): string {
  const d = r.days.trim().toLowerCase()
  const named = (parseDays(d) ?? []).map((x) => DAY_NAMES[x][0].toUpperCase() + DAY_NAMES[x].slice(1)).join(', ')
  const days = d === 'daily' || d === 'every day' ? 'Every day' : d === 'weekdays' ? 'Weekdays' : d === 'weekends' ? 'Weekends' : named || r.days
  return `${days} at ${r.time}`
}
