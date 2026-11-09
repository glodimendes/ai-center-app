import type { CalEvent, Plan, Preferences } from '@shared/types'
import type { PlanMetrics, PlanVariant } from '@shared/api'
import { WEEKDAYS, addDays, atMinutes, startOfDay, toHM } from '@shared/time'
import { NO_AREA } from '@shared/categories'

// Re-plan options: the same deterministic planner under different strategies.

export const PLAN_VARIANTS: { key: PlanVariant; label: string; desc: string }[] = [
  { key: 'balanced', label: 'Balanced', desc: 'Your settings as they are.' },
  { key: 'deadlines', label: 'Deadlines first', desc: 'Deadlines weigh 3× more and get guarded 2 days earlier; everything as soon as possible.' },
  { key: 'deep', label: 'Deep work first', desc: 'Deep-work areas get 25% more grid hours, 1.5× weight and 1h more per day; other areas get less.' },
  { key: 'light', label: 'Light week', desc: 'Daily caps, grid hours and weekly targets cut by a quarter; no reserved blocks.' }
]

const scale = (m: number, f: number, step: number) => Math.round((m * f) / step) * step
const quarterOff = (m: number, step: number) => scale(m, 0.75, step)
const scaleGrid = (prefs: Preferences, f: (key: string) => number): Preferences['allocation'] => ({
  ...prefs.allocation,
  hours: Object.fromEntries(Object.entries(prefs.allocation.hours).map(([k, row]) => [k, Object.fromEntries(Object.entries(row).map(([d, h]) => [d, scale(h ?? 0, f(k), 0.5)]))]))
})

export function applyVariant(prefs: Preferences, key: PlanVariant): Preferences {
  if (key === 'deadlines')
    return {
      ...prefs,
      strategy: { ...prefs.strategy, deadlineWeight: prefs.strategy.deadlineWeight * 3, deadlineGuardDays: prefs.strategy.deadlineGuardDays + 2 },
      categories: prefs.categories.map((c) => ({ ...c, timing: 'asap' }))
    }
  if (key === 'deep') {
    const deep = new Set(prefs.categories.filter((c) => c.deepWork).map((c) => c.key))
    return {
      ...prefs,
      maxDeepWorkMinutesPerDay: prefs.maxDeepWorkMinutesPerDay + 60,
      allocation: scaleGrid(prefs, (k) => (deep.has(k) ? 1.25 : 0.75)),
      categories: prefs.categories.map((c) => ({ ...c, weight: (c.weight ?? 1) * (c.deepWork ? 1.5 : 0.8) }))
    }
  }
  if (key === 'light')
    return {
      ...prefs,
      dailyMaxMinutes: { weekday: quarterOff(prefs.dailyMaxMinutes.weekday, 15), weekend: quarterOff(prefs.dailyMaxMinutes.weekend, 15) },
      maxDeepWorkMinutesPerDay: quarterOff(prefs.maxDeepWorkMinutesPerDay, 15),
      allocation: scaleGrid(prefs, () => 0.75),
      categories: prefs.categories.map((c) => ({
        ...c,
        reserveQuota: false,
        budget: c.budget?.minHours ? { ...c.budget, minHours: quarterOff(c.budget.minHours, 0.5) } : c.budget
      }))
    }
  return prefs
}

const WORK = new Set(['container', 'proposed', 'topup', 'pinned'])

/** What a plan means for the next 7 days, so options can be compared at a glance. */
export function planMetrics(p: Plan, prefs: Preferences, events: CalEvent[], now: Date): PlanMetrics {
  const from = startOfDay(now)
  const to = addDays(from, 7)
  const inRange = (s: string) => new Date(s) >= from && new Date(s) < to
  const work = p.blocks.filter((b) => WORK.has(b.kind) && b.category !== NO_AREA && inRange(b.start) && new Date(b.end) > now)
  const mins = (b: { start: string; end: string }) => (new Date(b.end).getTime() - new Date(b.start).getTime()) / 60_000
  const deep = new Set(prefs.categories.filter((c) => c.deepWork).map((c) => c.key))
  const evening = work.reduce((s, b) => {
    const cut = new Date(b.start)
    cut.setHours(19, 0, 0, 0)
    return s + Math.max(0, (new Date(b.end).getTime() - Math.max(cut.getTime(), new Date(b.start).getTime())) / 60_000)
  }, 0)

  // Free time: working hours not covered by any block or busy event.
  let free = 0
  for (let i = 0; i < 7; i++) {
    const day = addDays(from, i)
    const wh = prefs.workingHours[WEEKDAYS[day.getDay()] as keyof Preferences['workingHours']]
    if (!wh) continue
    const s = Math.max(atMinutes(day, toHM(wh[0])).getTime(), now.getTime())
    const e = atMinutes(day, toHM(wh[1])).getTime()
    if (e <= s) continue
    const taken = [...p.blocks, ...events.filter((x) => !x.allDay && !x.free && !x.plannerBlockId)]
      .map((x) => ({ s: Math.max(s, new Date(x.start).getTime()), e: Math.min(e, new Date(x.end).getTime()) }))
      .filter((x) => x.e > x.s)
      .sort((a, b) => a.s - b.s)
    let covered = 0
    let until = s
    for (const x of taken) {
      if (x.e <= until) continue
      covered += x.e - Math.max(x.s, until)
      until = x.e
    }
    free += (e - s - covered) / 60_000
  }

  return {
    workHours: work.reduce((s, b) => s + mins(b), 0) / 60,
    deepHours: work.filter((b) => deep.has(b.category)).reduce((s, b) => s + mins(b), 0) / 60,
    atRisk: p.warnings.filter((w) => w.kind === 'deadline').length,
    unscheduled: p.warnings.filter((w) => w.kind === 'unscheduled').length,
    eveningHours: evening / 60,
    switches: work.reduce((s, b) => s + b.chunks.filter((c) => c.minutes > 0).length, 0),
    freeHours: free / 60
  }
}
