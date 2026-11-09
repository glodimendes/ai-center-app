// Repeating tasks: a `repeat:<rule>` token on the task line.
//   repeat:daily  repeat:weekdays  repeat:weekly  repeat:biweekly  repeat:monthly  repeat:yearly
//   repeat:3d  repeat:2w  repeat:6m  repeat:1y      every N days / weeks / months / years
//   repeat:mon,thu                                  on these weekdays, every week
//   repeat:3w:sun                                   on these weekdays, every 3 weeks
// Checking one off adds the next occurrence (same line, next due date) above it.
// Weekday rules mean "on that day" (planned on the due date); interval rules mean "once per
// period" (planned anywhere in the period that ends on the due date).

import { addDays, isoDate, parseDate, startOfDay } from './time'

export type RepeatRule = { every: number; unit: 'd' | 'w' | 'm' | 'y' } | { weekdays: number[]; weeks: number }

const NAMED: Record<string, RepeatRule> = {
  daily: { every: 1, unit: 'd' },
  weekdays: { weekdays: [1, 2, 3, 4, 5], weeks: 1 },
  weekly: { every: 1, unit: 'w' },
  biweekly: { every: 2, unit: 'w' },
  monthly: { every: 1, unit: 'm' },
  yearly: { every: 1, unit: 'y' }
}
export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export function parseRepeat(rule: string): RepeatRule | null {
  const r = rule.trim().toLowerCase()
  if (NAMED[r]) return NAMED[r]
  const m = r.match(/^(\d+)([dwmy])$/)
  if (m && Number(m[1]) > 0) return { every: Number(m[1]), unit: m[2] as 'd' | 'w' | 'm' | 'y' }
  const w = r.match(/^(?:(\d+)w:)?([a-z,]+)$/)
  if (!w || (w[1] && Number(w[1]) < 1)) return null
  const days = w[2].split(',').map((d) => DAY_KEYS.indexOf(d as (typeof DAY_KEYS)[number]))
  if (days.length && days.every((d) => d >= 0)) return { weekdays: [...new Set(days)].sort(), weeks: w[1] ? Number(w[1]) : 1 }
  return null
}

const UNIT = { d: 'day', w: 'week', m: 'month', y: 'year' } as const
const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function describeRepeat(rule: string): string {
  const r = rule.trim().toLowerCase()
  if (r === 'weekdays') return 'Every weekday'
  if (r === 'biweekly') return 'Every 2 weeks'
  const p = parseRepeat(r)
  if (!p) return `Repeats (${rule})`
  if ('weekdays' in p) return `${p.weeks > 1 ? `Every ${p.weeks} weeks on` : 'Every'} ${p.weekdays.map((d) => DAY_LABEL[d]).join(', ')}`
  return p.every === 1 ? `Every ${UNIT[p.unit]}` : `Every ${p.every} ${UNIT[p.unit]}s`
}

function addMonths(d: Date, n: number) {
  const day = d.getDate()
  const out = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const last = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate()
  out.setDate(Math.min(day, last))
  return out
}

function step(d: Date, p: { every: number; unit: 'd' | 'w' | 'm' | 'y' }) {
  if (p.unit === 'd') return addDays(d, p.every)
  if (p.unit === 'w') return addDays(d, 7 * p.every)
  return addMonths(d, p.unit === 'm' ? p.every : 12 * p.every)
}

const monday = (x: Date) => addDays(x, -((x.getDay() + 6) % 7))

/** The occurrence after `from`; every N weeks skips the weeks in between when it wraps to a new week. */
function nextWeekday(from: Date, p: { weekdays: number[]; weeks: number }) {
  let d = addDays(from, 1)
  while (!p.weekdays.includes(d.getDay())) d = addDays(d, 1)
  if (p.weeks > 1 && monday(d).getTime() !== monday(from).getTime()) d = addDays(d, 7 * (p.weeks - 1))
  return d
}

/**
 * Due date of the next occurrence, counted from the current due date (or today when there
 * is none) and always after today, so a late check-off doesn't create an overdue copy.
 */
export function nextOccurrence(rule: string, due: string | undefined, today: Date): string | null {
  const p = parseRepeat(rule)
  if (!p) return null
  const t = startOfDay(today)
  const base = due ? parseDate(due) : t
  if ('weekdays' in p) {
    let d = base
    do d = nextWeekday(d, p)
    while (d <= t)
    return isoDate(d)
  }
  let d = step(base, p)
  while (d <= t) d = step(d, p)
  return isoDate(d)
}

/**
 * First day an occurrence may be planned: its due date for weekday rules ("on Mondays"),
 * the day after the previous occurrence for interval rules ("once a week").
 */
export function earliestFor(rule: string, due: string | undefined): string | null {
  const p = parseRepeat(rule)
  if (!p || !due) return null
  const d = parseDate(due)
  if ('weekdays' in p) return due
  const prev = p.unit === 'd' ? addDays(d, -p.every) : p.unit === 'w' ? addDays(d, -7 * p.every) : addMonths(d, -(p.unit === 'm' ? p.every : 12 * p.every))
  return isoDate(addDays(prev, 1))
}
