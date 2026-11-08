import type {
  Block,
  CalEvent,
  CategoryPref,
  Plan,
  PlanWarning,
  Preferences,
  Task,
  TrainingPlan,
  WeekData
} from '@shared/types'
import { WEEKDAYS, addDays, atMinutes, isoDate, isoWeek, localISO, startOfDay, toHM } from '@shared/time'
import { sessionFor } from '../vault/training'

// Deterministic Motion-style planner. Pure: same input, same plan.
//
// Order of placement:
//   1. pinned blocks (dragged or logged by the user) are fixed
//   2. today's training session goes into an existing Sports event, or a preferred window
//   3. tasks fill matching container events (e.g. "Thesis Deep Work"), earliest deadline first
//   4. leftover task time becomes proposed blocks in free time (respecting windows, budgets, deep-work cap)
//   5. weekly minimum budgets are topped up with extra blocks

export interface PlanInput {
  tasks: Task[]
  events: CalEvent[]
  prefs: Preferences
  training: TrainingPlan | null
  weeks: Record<string, WeekData>
  now: Date
}

const MAX_BLOCK_MIN = 180
const MIN = 60_000
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const

interface Span {
  s: number
  e: number
}

interface Working extends Block {
  s: number
  e: number
  /** Minutes still free for tasks (containers/proposed). */
  free: number
}

const overlaps = (a: Span, b: Span) => a.s < b.e && b.s < a.e

function subtract(spans: Span[], busy: Span[]): Span[] {
  let out = spans
  for (const b of busy) {
    const next: Span[] = []
    for (const s of out) {
      if (!overlaps(s, b)) next.push(s)
      else {
        if (b.s > s.s) next.push({ s: s.s, e: b.s })
        if (b.e < s.e) next.push({ s: b.e, e: s.e })
      }
    }
    out = next
  }
  return out
}

export function plan(input: PlanInput): Plan {
  const { tasks, events, prefs, training, weeks, now } = input
  const slot = prefs.slotMinutes * MIN
  const nowMs = Math.ceil(now.getTime() / slot) * slot
  const today = startOfDay(now)
  const days = Array.from({ length: prefs.horizonDays }, (_, i) => addDays(today, i))
  const horizonEnd = addDays(today, prefs.horizonDays).getTime()
  const cats = new Map(prefs.categories.map((c) => [c.key, c]))
  const catOf = (key: string): CategoryPref => cats.get(key) ?? cats.get('other') ?? prefs.categories[0]
  const warnings: PlanWarning[] = []
  const blocks: Working[] = []
  const taskFinish: Record<string, number> = {}
  const buffer = prefs.bufferMinutes * MIN

  const ignored = new Set(prefs.ignoreCalendars)
  const timed = events.filter(
    (e) => !e.allDay && !ignored.has(e.calendarName) && !e.plannerBlockId && new Date(e.end).getTime() > today.getTime()
  )
  const loggedIds = new Set(Object.values(weeks).flatMap((w) => w.log.map((l) => l.blockId)))
  const allPins = Object.values(weeks).flatMap((w) => w.pins)

  // --- containers -----------------------------------------------------------
  const containerCat = (e: CalEvent) =>
    prefs.categories.find(
      (c) =>
        c.calendar === e.calendarName &&
        c.containers.some((t) => e.title.trim().toLowerCase() === t.toLowerCase() || e.title.trim().toLowerCase().startsWith(t.toLowerCase()))
    )
  const busy: Span[] = []
  for (const e of timed) {
    const s = new Date(e.start).getTime()
    const en = new Date(e.end).getTime()
    busy.push({ s, e: en })
    const c = containerCat(e)
    if (!c || s >= horizonEnd) continue
    const id = `evt:${e.id}`
    const futureStart = Math.max(s, nowMs)
    blocks.push({
      id,
      kind: 'container',
      category: c.key,
      title: e.title,
      start: e.start,
      end: e.end,
      calendarName: e.calendarName,
      chunks: [],
      eventId: e.id,
      s,
      e: en,
      free: loggedIds.has(id) || c.key === prefs.training.category ? 0 : Math.max(0, (en - futureStart) / MIN)
    })
  }

  // --- pins -----------------------------------------------------------------
  const remaining = new Map<string, number>()
  const open = tasks.filter((t) => !t.done)
  const openIds = new Set(open.map((t) => t.id))
  for (const t of open) {
    const est = t.estimateMin ?? catOf(t.category).defaultEstimateMinutes
    remaining.set(t.id, Math.ceil(est / prefs.slotMinutes) * prefs.slotMinutes)
  }

  for (const p of allPins) {
    const s = new Date(p.start).getTime()
    const e = new Date(p.end).getTime()
    if (e <= today.getTime() || s >= horizonEnd) continue
    const block: Working = {
      id: p.blockId,
      kind: 'pinned',
      category: p.category,
      title: p.title,
      start: p.start,
      end: p.end,
      calendarName: catOf(p.category).calendar,
      chunks: [],
      pinned: true,
      s,
      e,
      free: 0
    }
    let cap = (e - Math.max(s, nowMs)) / MIN
    for (const id of p.taskIds) {
      const rem = remaining.get(id)
      if (rem === undefined) {
        if (!openIds.has(id)) block.chunks.push({ taskId: id, minutes: 0 })
        continue
      }
      const use = e <= nowMs ? 0 : Math.max(0, Math.min(rem, cap))
      block.chunks.push({ taskId: id, minutes: use || rem })
      if (use > 0) {
        remaining.set(id, rem - use)
        cap -= use
        taskFinish[id] = e
      }
    }
    blocks.push(block)
    busy.push({ s, e })
  }

  // --- free-time helpers ----------------------------------------------------
  const dayWindow = (day: Date, window?: [string, string]): Span | null => {
    const wh = prefs.workingHours[WEEKDAYS[day.getDay()] as keyof Preferences['workingHours']]
    if (!wh) return null
    let s = toHM(wh[0])
    let e = toHM(wh[1])
    if (window) {
      s = Math.max(s, toHM(window[0]))
      e = Math.min(e, toHM(window[1]))
    }
    if (e <= s) return null
    return { s: Math.max(atMinutes(day, s).getTime(), nowMs), e: atMinutes(day, e).getTime() }
  }

  const freeIn = (win: Span): Span[] => {
    const padded = busy.map((b) => ({ s: b.s - buffer, e: b.e + buffer }))
    return subtract([win], padded)
      .map((sp) => ({ s: Math.ceil(sp.s / slot) * slot, e: Math.floor(sp.e / slot) * slot }))
      .filter((sp) => sp.e > sp.s)
  }

  const deepUsed = (day: Date) => {
    const s = day.getTime()
    const e = addDays(day, 1).getTime()
    return blocks
      .filter((b) => catOf(b.category).deepWork && b.s < e && b.e > s)
      .reduce((sum, b) => sum + (Math.min(b.e, e) - Math.max(b.s, s)) / MIN, 0)
  }

  const weekOf = (ms: number) => isoWeek(new Date(ms))
  const loggedMinutes = (week: string, cat: string) =>
    (weeks[week]?.log ?? []).filter((l) => l.category === cat).reduce((s, l) => s + l.actualMin, 0)
  /** Logged time this week plus everything planned from now on. */
  const weekMinutes = (week: string, cat: string) =>
    loggedMinutes(week, cat) +
    blocks
      .filter((b) => b.category === cat && weekOf(b.s) === week && !loggedIds.has(b.id))
      .reduce((sum, b) => sum + Math.max(0, (b.e - Math.max(b.s, nowMs)) / MIN), 0)

  const usedIds = new Set(blocks.map((b) => b.id))
  const newId = (day: Date, cat: string) => {
    let n = 1
    while (usedIds.has(`${isoDate(day)}:${cat}:${n}`)) n++
    const id = `${isoDate(day)}:${cat}:${n}`
    usedIds.add(id)
    return id
  }

  /** Room left on a day for a category: window, deep-work cap and weekly max budget. */
  const allowance = (c: CategoryPref, day: Date) => {
    let room = Infinity
    if (c.deepWork) room = Math.min(room, prefs.maxDeepWorkMinutesPerDay - deepUsed(day))
    if (c.budget?.maxHours !== undefined) room = Math.min(room, c.budget.maxHours * 60 - weekMinutes(isoWeek(day), c.key))
    return Math.max(0, room)
  }

  /** Grow an existing proposed block of this category, or open a new one. Returns the block and minutes added. */
  const place = (c: CategoryPref, day: Date, wantMin: number, kind: 'proposed' | 'topup'): { block: Working; minutes: number } | null => {
    const win = dayWindow(day, c.window)
    if (!win) return null
    const room = Math.min(wantMin, allowance(c, day))
    if (room < Math.min(prefs.minChunkMinutes, wantMin)) return null

    // Extend a proposed block that ends where free time continues.
    for (const b of blocks) {
      if (b.category !== c.key || (b.kind !== 'proposed' && b.kind !== 'topup') || b.e > win.e) continue
      if (isoDate(new Date(b.s)) !== isoDate(day)) continue
      const len = (b.e - b.s) / MIN
      if (len >= MAX_BLOCK_MIN) continue
      const nextBusy = busy.filter((x) => x.s >= b.e && !(x.s === b.s && x.e === b.e)).reduce((m, x) => Math.min(m, x.s - buffer), win.e)
      const limit = Math.min(nextBusy, win.e)
      const ext = Math.floor(Math.min((limit - b.e) / MIN, MAX_BLOCK_MIN - len, room) / prefs.slotMinutes) * prefs.slotMinutes
      if (ext > 0 && ext >= Math.min(prefs.minChunkMinutes, wantMin)) {
        const span = busy.find((x) => x.s === b.s && x.e === b.e)
        b.e += ext * MIN
        b.end = localISO(new Date(b.e))
        if (span) span.e = b.e
        return { block: b, minutes: ext }
      }
    }

    for (const f of freeIn(win)) {
      const len = Math.floor(Math.min((f.e - f.s) / MIN, room, MAX_BLOCK_MIN) / prefs.slotMinutes) * prefs.slotMinutes
      if (len < Math.min(prefs.minChunkMinutes, wantMin)) continue
      const e = f.s + len * MIN
      const block: Working = {
        id: newId(day, c.key),
        kind,
        category: c.key,
        title: c.containers[0] ?? c.label,
        start: localISO(new Date(f.s)),
        end: localISO(new Date(e)),
        calendarName: c.calendar,
        chunks: [],
        s: f.s,
        e,
        free: 0
      }
      blocks.push(block)
      busy.push({ s: f.s, e })
      return { block, minutes: len }
    }
    return null
  }

  // --- training -------------------------------------------------------------
  const tc = catOf(prefs.training.category)
  if (training) {
    for (const day of days) {
      const session = sessionFor(training, prefs.training.cycleStart, day)
      if (!session || session.rest || !session.minutes) continue
      const dayS = day.getTime()
      const dayE = addDays(day, 1).getTime()
      const existing = blocks.find((b) => b.category === tc.key && b.s >= dayS && b.s < dayE)
      if (existing) {
        existing.trainingSession = session.session
        continue
      }
      if (dayE <= nowMs) continue
      let placed = false
      for (const w of prefs.training.preferredWindows) {
        const win = { s: Math.max(atMinutes(day, toHM(w[0])).getTime(), nowMs), e: atMinutes(day, toHM(w[1])).getTime() }
        if (win.e <= win.s) continue
        const f = freeIn(win).find((sp) => sp.e - sp.s >= session.minutes * MIN)
        if (!f) continue
        const e = f.s + session.minutes * MIN
        blocks.push({
          id: `train:${isoDate(day)}`,
          kind: 'training',
          category: tc.key,
          title: session.session,
          start: localISO(new Date(f.s)),
          end: localISO(new Date(e)),
          calendarName: tc.calendar,
          chunks: [],
          trainingSession: session.session,
          s: f.s,
          e,
          free: 0
        })
        busy.push({ s: f.s, e })
        placed = true
        break
      }
      if (!placed && dayS >= today.getTime())
        warnings.push({ kind: 'overload', category: tc.key, message: `No free slot for ${session.session} on ${isoDate(day)}.` })
    }
  }

  // --- tasks ----------------------------------------------------------------
  const order = new Map(tasks.map((t, i) => [t.id, i]))
  const hasOpenChild = (t: Task) => t.childIds.some((id) => openIds.has(id))
  const queue = open
    .filter((t) => !hasOpenChild(t) && t.category !== tc.key && (remaining.get(t.id) ?? 0) > 0)
    .sort(
      (a, b) =>
        (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        order.get(a.id)! - order.get(b.id)!
    )

  for (const t of queue) {
    const c = catOf(t.category)
    let rem = remaining.get(t.id)!
    const minChunk = Math.min(prefs.minChunkMinutes, rem)

    for (const b of blocks.filter((b) => b.kind === 'container' && b.category === c.key && b.free > 0).sort((x, y) => x.s - y.s)) {
      if (rem <= 0) break
      if (b.free < minChunk) continue
      const use = Math.min(rem, b.free)
      b.chunks.push({ taskId: t.id, minutes: use })
      b.free -= use
      rem -= use
      taskFinish[t.id] = Math.max(taskFinish[t.id] ?? 0, b.e)
    }

    // Reuse unassigned time in already-proposed blocks first.
    for (const b of blocks.filter((b) => (b.kind === 'proposed' || b.kind === 'topup') && b.category === c.key && b.free > 0).sort((x, y) => x.s - y.s)) {
      if (rem <= 0) break
      const use = Math.min(rem, b.free)
      if (use < minChunk) continue
      b.chunks.push({ taskId: t.id, minutes: use })
      b.free -= use
      rem -= use
      taskFinish[t.id] = Math.max(taskFinish[t.id] ?? 0, b.e)
    }

    for (const day of days) {
      while (rem > 0) {
        const got = place(c, day, rem, 'proposed')
        if (!got) break
        got.block.chunks.push({ taskId: t.id, minutes: got.minutes })
        rem -= got.minutes
        taskFinish[t.id] = Math.max(taskFinish[t.id] ?? 0, got.block.e)
      }
      if (rem <= 0) break
    }

    remaining.set(t.id, rem)
    if (rem > 0) warnings.push({ kind: 'unscheduled', taskId: t.id, category: c.key, message: `“${t.title}” doesn't fit in the next ${prefs.horizonDays} days (${rem} min left).` })
    if (t.due) {
      const dueEnd = addDays(new Date(t.due + 'T00:00:00'), 1).getTime()
      if (dueEnd <= nowMs) warnings.push({ kind: 'deadline', taskId: t.id, category: c.key, message: `“${t.title}” is overdue (due ${t.due}).` })
      else if (rem > 0 || (taskFinish[t.id] ?? 0) > dueEnd)
        warnings.push({ kind: 'deadline', taskId: t.id, category: c.key, message: `“${t.title}” won't be done before its deadline (${t.due}).` })
    }
  }

  // --- weekly budgets -------------------------------------------------------
  const weeksInHorizon = [...new Set(days.map((d) => isoWeek(d)))]
  for (const c of prefs.categories) {
    const min = c.budget?.minHours
    const max = c.budget?.maxHours
    for (const week of weeksInHorizon) {
      const weekDays = days.filter((d) => isoWeek(d) === week)
      if (min !== undefined) {
        for (const day of weekDays) {
          let need = min * 60 - weekMinutes(week, c.key)
          while (need >= prefs.minChunkMinutes) {
            const got = place(c, day, Math.min(need, MAX_BLOCK_MIN), 'topup')
            if (!got) break
            got.block.free += got.minutes
            need -= got.minutes
          }
        }
        const total = weekMinutes(week, c.key)
        // Only warn for weeks fully inside the horizon.
        if (total < min * 60 && weekDays.length === 7)
          warnings.push({ kind: 'budget-behind', category: c.key, message: `${c.label}: ${Math.round(total / 6) / 10}h planned for ${week}, target ${min}h.` })
        else if (total < min * 60 && week === isoWeek(today))
          warnings.push({ kind: 'budget-behind', category: c.key, message: `${c.label}: ${Math.round(total / 6) / 10}h this week, target ${min}h.` })
      }
      if (max !== undefined) {
        const total = weekMinutes(week, c.key)
        if (total > max * 60)
          warnings.push({ kind: 'budget-over', category: c.key, message: `${c.label}: ${Math.round(total / 6) / 10}h in ${week}, above the ${max}h cap.` })
      }
    }
  }

  const out: Block[] = blocks
    .sort((a, b) => a.s - b.s)
    .map(({ s: _s, e: _e, free: _f, ...b }) => b)
  return {
    generatedAt: now.toISOString(),
    blocks: out,
    warnings,
    taskFinish: Object.fromEntries(Object.entries(taskFinish).map(([k, v]) => [k, localISO(new Date(v))]))
  }
}
