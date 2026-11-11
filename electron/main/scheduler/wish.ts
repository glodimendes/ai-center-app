import type { PlanVariant, Wish } from '@shared/api'
import type { DayRule, Preferences, WeekData, Weekday } from '@shared/types'
import { WEEKDAYS, addDays, isoDate, isoWeek, parseDate, startOfDay } from '@shared/time'

const VARIANTS: PlanVariant[] = ['balanced', 'deadlines', 'deep', 'light']
const HM = /^([01]\d|2[0-3]):[0-5]\d$/

export function wishDates(now: Date, days = 14) {
  return Array.from({ length: days }, (_, i) => addDays(startOfDay(now), i))
}

export function wishPrompt(text: string, prefs: Preferences, now: Date): string {
  const dates = wishDates(now).map((d) => `${isoDate(d)} (${d.toLocaleDateString('en-GB', { weekday: 'long' })})`)
  const areas = prefs.categories.filter((c) => c.key !== 'other').map((c) => `${c.key} = ${c.label}`)
  const grid = Object.entries(prefs.allocation.hours).map(([k, row]) => `${k}: ${Object.entries(row).map(([d, h]) => `${d} ${h}h`).join(', ')}`)
  return [
    'Turn the user\'s wish for their planner into changes. Only change what the wish asks for; when it is vague, choose the smallest sensible change.',
    `Wish: """${text}"""`,
    `Dates you may use (next 14 days): ${dates.join('; ')}`,
    `Areas (use the key): ${areas.join('; ')}`,
    `Current hours set aside per area per weekday: ${grid.join(' | ') || 'none'}`,
    'Strategies: balanced (as set), deadlines (deadline-heavy), deep (more deep work), light (25% lighter week).',
    'Answer with JSON only:',
    '{"summary": "<one short sentence>", "strategy": "<optional: balanced|deadlines|deep|light>",',
    ' "limits": [{"date": "YYYY-MM-DD", "areas": ["<area key>"] (empty = all work), "maxMinutes": 0 (none) or a cap in minutes, "from": "HH:MM" (optional), "to": "HH:MM" (optional)}],',
    ' "hours": [{"date": "YYYY-MM-DD", "area": "<area key>", "hours": <number>}]}'
  ].join('\n')
}

/** Keeps only what makes sense: known dates, areas, times and numbers. */
export function sanitizeWish(raw: unknown, prefs: Preferences, now: Date): Wish {
  const r = (raw ?? {}) as Record<string, unknown>
  const dates = new Set(wishDates(now).map(isoDate))
  const areas = new Set(prefs.categories.map((c) => c.key))
  const list = (x: unknown) => (Array.isArray(x) ? x : []) as Record<string, unknown>[]
  return {
    summary: String(r.summary ?? '').slice(0, 200),
    strategy: VARIANTS.includes(r.strategy as PlanVariant) ? (r.strategy as PlanVariant) : undefined,
    limits: list(r.limits)
      .filter((l) => dates.has(String(l.date)))
      .map((l) => ({
        date: String(l.date),
        areas: (Array.isArray(l.areas) ? l.areas.map(String) : []).filter((a) => areas.has(a)),
        maxMinutes: Math.max(0, Math.min(24 * 60, Math.round(Number(l.maxMinutes) || 0))),
        ...(HM.test(String(l.from ?? '')) ? { from: String(l.from) } : {}),
        ...(HM.test(String(l.to ?? '')) ? { to: String(l.to) } : {})
      })),
    hours: list(r.hours)
      .filter((h) => dates.has(String(h.date)) && areas.has(String(h.area)) && Number.isFinite(Number(h.hours)))
      .map((h) => ({ date: String(h.date), area: String(h.area), hours: Math.max(0, Math.min(14, Math.round(Number(h.hours) * 2) / 2)) }))
  }
}

/** The weeks with the wish written into their overrides (pure: used for the preview and to save). */
export function weeksWithWish(weeks: Record<string, WeekData>, wish: Wish, prefs: Preferences, stamp: string): Record<string, WeekData> {
  const out = { ...weeks }
  const week = (date: string) => {
    const key = isoWeek(parseDate(date))
    const w = out[key] ?? { week: key, log: [], pins: [] }
    out[key] = { ...w, overrides: { ...w.overrides } }
    return out[key].overrides!
  }
  wish.limits.forEach((l, i) => {
    const o = week(l.date)
    const rule: DayRule = { id: `wish-${stamp}-${i}`, label: `Wish: ${wish.summary || 'limit'}`.slice(0, 60), enabled: true, when: 'dates', dates: [l.date], weekdays: [], areas: l.areas, maxMinutes: l.maxMinutes, from: l.from, to: l.to }
    o.dayRules = [...(o.dayRules ?? []), rule]
  })
  for (const h of wish.hours) {
    const o = week(h.date)
    const grid = JSON.parse(JSON.stringify(o.grid ?? prefs.allocation.hours)) as Record<string, Partial<Record<Weekday, number>>>
    grid[h.area] = { ...grid[h.area], [WEEKDAYS[parseDate(h.date).getDay()] as Weekday]: h.hours }
    o.grid = grid
  }
  return out
}

/** One line per change, for the preview. */
export function describeWish(wish: Wish, prefs: Preferences): string[] {
  const label = (k: string) => prefs.categories.find((c) => c.key === k)?.label ?? k
  const day = (d: string) => parseDate(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const lines = [
    ...wish.limits.map((l) => {
      const what = l.areas.length ? l.areas.map(label).join(', ') : 'work'
      if (l.maxMinutes > 0) return `${day(l.date)}: at most ${Math.round(l.maxMinutes / 6) / 10}h of ${what}`
      const span = l.from && l.to ? `between ${l.from} and ${l.to}` : l.from ? `after ${l.from}` : l.to ? `before ${l.to}` : 'all day'
      return `${day(l.date)}: no ${what} ${span}`
    }),
    ...wish.hours.map((h) => `${day(h.date)}: ${h.hours}h for ${label(h.area)}`)
  ]
  if (wish.strategy) lines.push(`Strategy: ${wish.strategy}`)
  return lines
}
