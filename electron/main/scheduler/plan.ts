import type { Block, CalEvent, CategoryPref, DayRule, Plan, PlanWarning, Preferences, Task, WeekData, Weekday } from '@shared/types'
import { WEEKDAYS, addDays, atMinutes, isoDate, isoWeek, localISO, startOfDay, toHM, weekStart } from '@shared/time'
import { earliestFor } from '@shared/repeat'
import { NO_AREA, noAreaCategory } from '@shared/categories'

// Deterministic Motion-style planner. Pure: same input, same plan.
//
// Placement order:
//   1. pins (dragged/logged blocks) and, when re-planning incrementally, the previous plan's blocks stay put
//   2. training tasks, then floating breaks (lunch, dinner) in the first free stretch of their window,
//      then tasks due within the deadline guard, then reserved grid hours (e.g. thesis) in their preferred windows
//   3. other tasks, most urgent first, day by day: containers → free room in existing blocks →
//      grow a block → new block in the category's preferred windows (in order) → anywhere in its hard window
//   4. leftover pass: tasks still unplaced (by priority) may use days where their area has 0 grid hours
//   5. weekly minimum budgets are topped up
//
// Training is an ordinary area, except: a gap around it, and it doesn't count toward the daily work cap.
//
// Day limits: working hours, daily work cap, deep-work cap, per-task-per-day cap, weekly caps.
// Incremental mode never moves an existing block; it only refreshes which tasks sit in it.

export interface PlanInput {
  tasks: Task[]
  events: CalEvent[]
  prefs: Preferences
  weeks: Record<string, WeekData>
  now: Date
  /** Previous plan. Blocks that already started today are always kept as they were. */
  previous?: Plan | null
  /** Also keep the previous plan's future blocks in place (incremental). Defaults to true when `previous` is given. */
  anchorFuture?: boolean
  fullPlannedAt?: string
  /** Block ids the user deleted from their calendar: never recreated under that id. */
  excludeIds?: string[]
  /** Per-event busy/free overrides keyed `${calendarId}:${eventId}`; win over the calendar's own setting. */
  eventAvailability?: Record<string, 'busy' | 'free'>
  /** Shuffle: a different but still deterministic arrangement (score jitter ±15%, seeded tie-breaks). */
  seed?: number
}

const MIN = 60_000
const DAY = 86_400_000
const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 } as const
const WORK_KINDS = new Set(['container', 'proposed', 'topup', 'pinned'])

interface Span {
  s: number
  e: number
  pad: number
}

interface Working extends Block {
  s: number
  e: number
  /** Minutes still free for tasks. */
  free: number
  /** Kept from the previous plan: never moved, may shrink at the end only. */
  anchored?: boolean
  /** Already started or past: shown as it was, no new tasks. */
  frozen?: boolean
}

const overlaps = (a: { s: number; e: number }, b: { s: number; e: number }) => a.s < b.e && b.s < a.e

function subtract(spans: { s: number; e: number }[], busy: { s: number; e: number }[]) {
  let out = spans
  for (const b of busy) {
    const next: { s: number; e: number }[] = []
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
  const { tasks, events, prefs, weeks, now, previous } = input
  const anchorFuture = Boolean(previous) && input.anchorFuture !== false
  const slot = prefs.slotMinutes * MIN
  const nowMs = Math.ceil(now.getTime() / slot) * slot
  const today = startOfDay(now)
  const todayISO = isoDate(today)
  const days = Array.from({ length: prefs.horizonDays }, (_, i) => addDays(today, i))
  const horizonEnd = addDays(today, prefs.horizonDays).getTime()
  const cats = new Map(prefs.categories.map((c) => [c.key, c]))
  const catOf = (key: string): CategoryPref => (key === NO_AREA ? noAreaCategory(prefs.categories) : (cats.get(key) ?? cats.get('other') ?? prefs.categories[0]))
  const tc = catOf(prefs.training.category)
  const warnings: PlanWarning[] = []
  const blocks: Working[] = []
  const busy: Span[] = []
  const taskFinish: Record<string, number> = {}
  const buf = prefs.bufferMinutes * MIN
  const padFor = (category: string) =>
    category === tc.key ? prefs.trainingBufferMinutes * MIN : catOf(category).deepWork ? prefs.deepWorkBufferMinutes * MIN : buf
  const dayKey = (ms: number) => isoDate(new Date(ms))
  const loggedIds = new Set(Object.values(weeks).flatMap((w) => w.log.map((l) => l.blockId)))
  // Manual overrides from the weekly files: dismissed blocks behave like calendar deletions.
  const overrides = Object.values(weeks).map((w) => w.overrides ?? {})
  const dismissed = new Set(overrides.flatMap((o) => o.dismissed ?? []))
  const excluded = new Set([...(input.excludeIds ?? []), ...dismissed])
  const excludedPair = new Set(overrides.flatMap((o) => (o.exclusions ?? []).map((x) => `${x.blockId}\n${x.taskId}`)))
  const isExcluded = (blockId: string, taskId: string) => excludedPair.has(`${blockId}\n${taskId}`)
  const usedIds = new Set<string>(excluded)

  const addBlock = (b: Working) => {
    blocks.push(b)
    usedIds.add(b.id)
    if (b.e > nowMs) busy.push({ s: b.s, e: b.e, pad: b.kind === 'break' ? 0 : padFor(b.category) })
  }

  // --- calendar events and containers ---------------------------------------
  const ignored = new Set(prefs.ignoreCalendars)
  // Free events (per-event override first, else the calendar's own flag or an ignored calendar) never block time.
  const isFree = (e: CalEvent) => {
    const o = input.eventAvailability?.[`${e.calendarId}:${e.id}`]
    return o ? o === 'free' : Boolean(e.free) || ignored.has(e.calendarName)
  }
  const timed = events.filter((e) => !e.allDay && !isFree(e) && !e.plannerBlockId && new Date(e.end).getTime() > today.getTime())
  const containerCat = (e: CalEvent) => {
    const title = e.title.trim().toLowerCase()
    return prefs.categories.find((c) => c.calendar === e.calendarName && c.containers.some((t) => title === t.toLowerCase() || title.startsWith(t.toLowerCase())))
  }
  const eventSpans: Span[] = []
  for (const e of timed) {
    const s = new Date(e.start).getTime()
    const en = new Date(e.end).getTime()
    const c = containerCat(e)
    const isSport = c?.key === tc.key || e.calendarName === tc.calendar
    const span = { s, e: en, pad: isSport ? prefs.trainingBufferMinutes * MIN : buf }
    eventSpans.push(span)
    if (!c || s >= horizonEnd) {
      busy.push(span)
      continue
    }
    const id = `evt:${e.id}`
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
      // Dismissed containers stay busy but aren't filled.
      free: loggedIds.has(id) || excluded.has(id) ? 0 : Math.max(0, (en - Math.max(s, nowMs)) / MIN)
    })
    usedIds.add(id)
    busy.push({ ...span, pad: c.deepWork ? prefs.deepWorkBufferMinutes * MIN : span.pad })
  }

  // --- holds: a removed block's time stays empty until the user re-plans ---------
  for (const h of overrides.flatMap((o) => o.holds ?? [])) {
    const s = new Date(h.start).getTime()
    const e = new Date(h.end).getTime()
    if (e > nowMs && s < horizonEnd) busy.push({ s, e, pad: 0 })
  }

  // --- remaining work per task ----------------------------------------------
  const open = tasks.filter((t) => !t.done)
  const openIds = new Set(open.map((t) => t.id))
  const remaining = new Map<string, number>()
  for (const t of open) {
    const est = t.estimateMin ?? catOf(t.category).defaultEstimateMinutes
    remaining.set(t.id, Math.ceil(est / prefs.slotMinutes) * prefs.slotMinutes)
  }
  /** taskId → day → minutes planned that day */
  const perDay = new Map<string, Map<string, number>>()
  const assign = (b: Working, taskId: string, minutes: number) => {
    const same = b.chunks.find((c) => c.taskId === taskId)
    if (same) same.minutes += minutes
    else b.chunks.push({ taskId, minutes })
    b.free -= minutes
    remaining.set(taskId, (remaining.get(taskId) ?? 0) - minutes)
    const m = perDay.get(taskId) ?? new Map<string, number>()
    m.set(dayKey(b.s), (m.get(dayKey(b.s)) ?? 0) + minutes)
    perDay.set(taskId, m)
    taskFinish[taskId] = Math.max(taskFinish[taskId] ?? 0, b.e)
  }

  // A task postponed past a block's day leaves that block (pinned or assigned).
  const postponedTo = new Map(tasks.filter((t) => t.postponed).map((t) => [t.id, t.postponed!]))
  const postponedPast = (taskId: string, ms: number) => (postponedTo.get(taskId) ?? '') > dayKey(ms)

  // --- pins -----------------------------------------------------------------
  for (const p of Object.values(weeks).flatMap((w) => w.pins)) {
    const s = new Date(p.start).getTime()
    const e = new Date(p.end).getTime()
    // A pin deleted in the calendar is excluded too (moved first, then deleted); its tasks go back to the pool.
    if (e <= today.getTime() || s >= horizonEnd || excluded.has(p.blockId)) continue
    const block: Working = { id: p.blockId, kind: 'pinned', category: p.category, title: p.title, start: p.start, end: p.end, calendarName: catOf(p.category).calendar, chunks: [], pinned: true, s, e, free: 0 }
    let cap = (e - Math.max(s, nowMs)) / MIN
    for (const id of p.taskIds) {
      if (postponedPast(id, s)) continue
      const rem = remaining.get(id)
      if (rem === undefined) {
        if (!openIds.has(id)) block.chunks.push({ taskId: id, minutes: 0 })
        continue
      }
      const use = e <= nowMs ? 0 : Math.max(0, Math.min(rem, cap))
      if (use > 0) {
        block.free = use
        assign(block, id, use)
        cap -= use
      } else block.chunks.push({ taskId: id, minutes: rem })
    }
    // A drawn block's time left over after its own tasks is filled like a container.
    block.free = p.fill && e > nowMs ? Math.max(0, cap) : 0
    if (p.fill) block.fill = true
    addBlock(block)
  }

  // --- previous plan: frozen past, anchored future ----------------------------
  if (previous) {
    for (const b of previous.blocks) {
      // 'training' blocks came from the old training cycle (cached plans); training is planned as tasks now.
      if (b.kind === 'container' || b.kind === 'pinned' || (b.kind as string) === 'training' || usedIds.has(b.id) || excluded.has(b.id)) continue
      const s = new Date(b.start).getTime()
      const e = new Date(b.end).getTime()
      if (s >= horizonEnd || e <= today.getTime()) continue
      if (s < nowMs) {
        // Started or done today: shown as it was (loggable), never moved.
        if (dayKey(s) === todayISO) addBlock({ ...b, s, e, free: 0, frozen: true })
        continue
      }
      if (!anchorFuture) continue
      const clash = eventSpans.find((x) => overlaps(x, { s, e })) ?? blocks.find((x) => x.e > nowMs && overlaps(x, { s, e }))
      if (clash) {
        warnings.push({ kind: 'conflict', category: b.category, message: `“${b.title}” at ${b.start.slice(5, 16).replace('T', ' ')} now clashes with your calendar; its tasks moved.` })
        continue
      }
      const len = (e - s) / MIN
      addBlock({ ...b, chunks: [], s, e, free: b.kind === 'proposed' || b.kind === 'topup' ? len : 0, anchored: true })
    }
  }

  // --- manual assignments: tasks the user put into a block go there first ----------
  for (const o of overrides) {
    for (const a of o.assignments ?? []) {
      const b = blocks.find((x) => x.id === a.blockId)
      if (!b || b.frozen || excluded.has(b.id)) continue
      for (const id of a.taskIds) {
        if (postponedPast(id, b.s)) continue
        const use = Math.min(remaining.get(id) ?? 0, b.free)
        if (use > 0 && !isExcluded(b.id, id)) assign(b, id, use)
      }
    }
  }

  // --- helpers --------------------------------------------------------------
  const dayWindow = (day: Date, window?: [string, string]): { s: number; e: number } | null => {
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
  const intersect = (a: { s: number; e: number } | null, w?: [string, string], day?: Date) => {
    if (!a || !w || !day) return a
    const s = Math.max(a.s, atMinutes(day, toHM(w[0])).getTime())
    const e = Math.min(a.e, atMinutes(day, toHM(w[1])).getTime())
    return e > s ? { s, e } : null
  }

  /** Free stretches inside a window, keeping each neighbour's buffer and our own. */
  const freeIn = (win: { s: number; e: number }, ownPad: number) =>
    subtract(
      [win],
      busy.map((b) => ({ s: b.s - Math.max(b.pad, ownPad), e: b.e + Math.max(b.pad, ownPad) }))
    )
      .map((sp) => ({ s: Math.ceil(sp.s / slot) * slot, e: Math.floor(sp.e / slot) * slot }))
      .filter((sp) => sp.e > sp.s)

  const minutesOn = (day: Date, pred: (b: Working) => boolean) => {
    const s = day.getTime()
    const e = s + DAY
    return blocks.filter((b) => pred(b) && b.s < e && b.e > s).reduce((sum, b) => sum + (Math.min(b.e, e) - Math.max(b.s, s)) / MIN, 0)
  }
  const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6
  const dailyMax = (d: Date) => (isWeekend(d) ? prefs.dailyMaxMinutes.weekend : prefs.dailyMaxMinutes.weekday)

  const loggedMinutes = (week: string, cat: string) => (weeks[week]?.log ?? []).filter((l) => l.category === cat).reduce((s, l) => s + l.actualMin, 0)
  const weekMinutes = (week: string, cat: string) =>
    loggedMinutes(week, cat) +
    blocks
      .filter((b) => b.category === cat && b.kind !== 'break' && isoWeek(new Date(b.s)) === week && !loggedIds.has(b.id))
      .reduce((sum, b) => sum + Math.max(0, (b.e - Math.max(b.s, nowMs)) / MIN), 0)

  const newId = (day: Date, cat: string) => {
    let n = 1
    while (usedIds.has(`${isoDate(day)}:${cat}:${n}`)) n++
    return `${isoDate(day)}:${cat}:${n}`
  }

  // --- day rules (Settings → Day rules) ---------------------------------------------
  // They shape where the planner may put new time; your own calendar events and pins are untouched.
  const calendarLoad = (date: Date) => {
    const s = date.getTime()
    const e = s + DAY
    return events
      .filter((x) => !x.allDay && !isFree(x) && !x.plannerBlockId)
      .reduce((sum, x) => sum + Math.max(0, Math.min(new Date(x.end).getTime(), e) - Math.max(new Date(x.start).getTime(), s)) / MIN, 0)
  }
  const picks = new Map<string, string | null>()
  /** "One day per week": the week's pick, else the candidate weekday with the least calendar time (later day on a tie). */
  const pickedDay = (r: DayRule, day: Date) => {
    const week = isoWeek(day)
    const key = `${r.id}\n${week}`
    if (!picks.has(key)) {
      const chosen = weeks[week]?.overrides?.dayPicks?.[r.id]
      if (chosen) picks.set(key, chosen)
      else {
        const start = weekStart(day)
        const candidates = Array.from({ length: 7 }, (_, i) => addDays(start, i)).filter((d) => r.weekdays.includes(WEEKDAYS[d.getDay()] as Weekday) && prefs.workingHours[WEEKDAYS[d.getDay()] as Weekday])
        const best = candidates.reduce<{ d: Date; load: number } | null>((b, d) => {
          const load = calendarLoad(d)
          return !b || load <= b.load ? { d, load } : b
        }, null)
        picks.set(key, best ? isoDate(best.d) : null)
      }
    }
    return picks.get(key)
  }
  const rulesOn = (day: Date) =>
    (prefs.dayRules ?? []).filter((r) => r.enabled && (r.when === 'pick' ? pickedDay(r, day) === isoDate(day) : r.weekdays.includes(WEEKDAYS[day.getDay()] as Weekday)))
  const ruleAffects = (r: DayRule, key: string) => (r.areas.length ? r.areas.includes(key) : key !== tc.key && key !== NO_AREA && key !== 'break')
  /** Time this area must stay out of on this day. */
  const ruleSpans = (c: CategoryPref, day: Date) =>
    rulesOn(day)
      .filter((r) => r.maxMinutes <= 0 && ruleAffects(r, c.key))
      .map((r) => ({ s: r.from ? atMinutes(day, toHM(r.from)).getTime() : day.getTime(), e: r.to ? atMinutes(day, toHM(r.to)).getTime() : day.getTime() + DAY }))
  /** Minutes this area may still get on this day under capping rules (Infinity when none applies). */
  const ruleRoom = (c: CategoryPref, day: Date) =>
    rulesOn(day)
      .filter((r) => r.maxMinutes > 0 && ruleAffects(r, c.key))
      .reduce((room, r) => Math.min(room, r.maxMinutes - minutesOn(day, (b) => WORK_KINDS.has(b.kind) && ruleAffects(r, b.category))), Infinity)

  /**
   * Grid hours for an area on a day, or null when the grid doesn't limit it (grid off, or training).
   * An area without a row (e.g. Other) has no hours set aside: 0, so it only gets leftover time.
   */
  const quota = (c: CategoryPref, day: Date): number | null => {
    if (!prefs.allocation.enabled || c.key === tc.key) return null
    // A week can carry its own grid (set in the weekly review); otherwise the one from Settings.
    const row = weeks[isoWeek(day)]?.overrides?.grid?.[c.key] ?? prefs.allocation.hours[c.key]
    if (!row) return 0
    return (row[WEEKDAYS[day.getDay()] as keyof typeof row] ?? 0) * 60
  }
  const areaMinutes = (c: CategoryPref, day: Date) => minutesOn(day, (b) => WORK_KINDS.has(b.kind) && b.category === c.key)

  /**
   * Room for new time of this category on this day: daily cap, deep-work cap, weekly max and
   * grid hours. Deadline-guarded tasks may go past the grid (not past the daily caps).
   */
  const allowance = (c: CategoryPref, day: Date, guarded = false, leftover = false) => {
    // Training sits outside the daily work cap and doesn't use it up.
    let room = c.key === tc.key ? Infinity : dailyMax(day) - minutesOn(day, (b) => WORK_KINDS.has(b.kind) && b.e > nowMs && b.category !== tc.key && b.category !== NO_AREA)
    if (c.deepWork) room = Math.min(room, prefs.maxDeepWorkMinutesPerDay - minutesOn(day, (b) => WORK_KINDS.has(b.kind) && catOf(b.category).deepWork === true))
    if (c.budget?.maxHours !== undefined) room = Math.min(room, c.budget.maxHours * 60 - weekMinutes(isoWeek(day), c.key))
    const q = quota(c, day)
    // Leftover pass: only days with no hours set aside for the area (checked by the caller), no grid limit.
    if (q !== null && !guarded && !leftover) room = Math.min(room, q - areaMinutes(c, day))
    room = Math.min(room, ruleRoom(c, day))
    return Math.max(0, room)
  }

  /** Grow an existing new block of this category on this day (end only); never one `taskId` is excluded from. */
  const grow = (c: CategoryPref, day: Date, want: number, taskId?: string): Working | null => {
    const win = dayWindow(day, c.window)
    if (!win) return null
    for (const b of blocks) {
      if (b.category !== c.key || (b.kind !== 'proposed' && b.kind !== 'topup') || b.anchored || b.frozen || dayKey(b.s) !== isoDate(day) || b.e > win.e || (taskId && isExcluded(b.id, taskId))) continue
      const len = (b.e - b.s) / MIN
      if (len >= prefs.maxBlockMinutes) continue
      const pad = padFor(c.key)
      const nextBusy = busy.filter((x) => x.s >= b.e && !(x.s === b.s && x.e === b.e)).reduce((m, x) => Math.min(m, x.s - Math.max(x.pad, pad)), win.e)
      // A day rule's span stops growth at its start (and a block ending inside one can't grow).
      const ruleStop = ruleSpans(c, day).filter((sp) => sp.e > b.e).reduce((m, sp) => Math.min(m, sp.s), Infinity)
      const ext = Math.floor(Math.min((Math.min(nextBusy, win.e, ruleStop) - b.e) / MIN, prefs.maxBlockMinutes - len, want) / prefs.slotMinutes) * prefs.slotMinutes
      if (ext <= 0) continue
      const span = busy.find((x) => x.s === b.s && x.e === b.e)
      b.e += ext * MIN
      b.end = localISO(new Date(b.e))
      b.free += ext
      if (span) span.e = b.e
      return b
    }
    return null
  }

  /** Open a new block: each preferred window in order, then the hard window. */
  const open_ = (c: CategoryPref, day: Date, want: number, kind: 'proposed' | 'topup', need = 0): Working | null => {
    const hard = dayWindow(day, c.window)
    if (!hard) return null
    const minBlock = c.minBlockMinutes ?? prefs.minChunkMinutes
    for (const win of [...(c.preferredWindows ?? []).map((w) => intersect(hard, w, day)), hard]) {
      if (!win) continue
      const free = subtract(freeIn(win, padFor(c.key)), ruleSpans(c, day))
        .map((sp) => ({ s: Math.ceil(sp.s / slot) * slot, e: Math.floor(sp.e / slot) * slot }))
        .filter((sp) => sp.e > sp.s)
      for (const f of free) {
        const fit = Math.floor(Math.min((f.e - f.s) / MIN, prefs.maxBlockMinutes) / prefs.slotMinutes) * prefs.slotMinutes
        const len = Math.min(fit, Math.max(want, minBlock))
        if (len < Math.max(minBlock, need)) continue
        const e = f.s + len * MIN
        const block: Working = { id: newId(day, c.key), kind, category: c.key, title: c.containers[0] ?? c.label, start: localISO(new Date(f.s)), end: localISO(new Date(e)), calendarName: c.calendar, chunks: [], s: f.s, e, free: len }
        addBlock(block)
        return block
      }
    }
    return null
  }

  // --- breaks (placed after training, before other tasks) --------------------------
  const placeBreaks = () => {
    for (const day of days) {
      if (!dayWindow(day)) continue
      for (const br of prefs.breaks) {
        if (blocks.some((b) => b.kind === 'break' && b.title === br.label && dayKey(b.s) === isoDate(day))) continue
        if (excluded.has(`break:${isoDate(day)}:${br.label}`)) continue
        const win = { s: Math.max(atMinutes(day, toHM(br.window[0])).getTime(), nowMs), e: atMinutes(day, toHM(br.window[1])).getTime() }
        if (win.e - win.s < br.minutes * MIN) continue
        const f = freeIn(win, 0).find((sp) => sp.e - sp.s >= br.minutes * MIN)
        if (!f) continue
        const e = f.s + br.minutes * MIN
        addBlock({ id: `break:${isoDate(day)}:${br.label}`, kind: 'break', category: 'break', title: br.label, start: localISO(new Date(f.s)), end: localISO(new Date(e)), calendarName: '', chunks: [], s: f.s, e, free: 0 })
      }
    }
  }

  // --- tasks ------------------------------------------------------------------
  const order = new Map(tasks.map((t, i) => [t.id, i]))
  const daysOverdue = (t: Task) => (t.due ? Math.round((today.getTime() - new Date(t.due + 'T00:00:00').getTime()) / DAY) : -Infinity)
  const isStale = (t: Task) => daysOverdue(t) > prefs.staleOverdueDays
  const st = prefs.strategy
  // Guarded: due within N days (or recently overdue) → first, earliest deadline first, may exceed grid hours.
  const isGuarded = (t: Task) => Boolean(t.due) && !isStale(t) && -daysOverdue(t) <= st.deadlineGuardDays
  const PRI_VALUE = { urgent: 2, high: 1, medium: 0.5, low: 0 } as const
  /** Weighted score: (deadline weight × urgency + priority weight × priority) × area weight. */
  const score = (t: Task) => {
    const urgency = t.due && !isStale(t) ? 1 / (1 + Math.max(0, -daysOverdue(t))) : 0
    return (st.deadlineWeight * urgency + st.priorityWeight * PRI_VALUE[t.priority]) * (catOf(t.category).weight ?? 1)
  }
  const group = (t: Task) => (isGuarded(t) ? 0 : isStale(t) ? 2 : 1)
  const seeded = (id: string) => {
    let h = 2166136261 ^ (input.seed ?? 0)
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
    return ((h >>> 0) % 10_000) / 10_000
  }
  const shuffle = input.seed !== undefined
  const ranked = (t: Task) => score(t) * (shuffle ? 0.85 + 0.3 * seeded(t.id) : 1)
  const hasOpenChild = (t: Task) => t.childIds.some((id) => openIds.has(id))
  const queue = open
    .filter((t) => !hasOpenChild(t) && (remaining.get(t.id) ?? 0) > 0)
    .sort(
      (a, b) =>
        group(a) - group(b) ||
        (group(a) === 0 ? a.due!.localeCompare(b.due!) : 0) ||
        ranked(b) - ranked(a) ||
        (shuffle ? seeded(a.id) - seeded(b.id) : 0) ||
        order.get(a.id)! - order.get(b.id)!
    )

  /** First plannable day: a postponed date, and for repeating tasks their period (shared/repeat.ts). */
  const earliestOf = (t: Task) => [t.repeat ? earliestFor(t.repeat, t.due) : null, t.postponed ?? null].reduce<string | null>((a, b) => (!b ? a : !a || b > a ? b : a), null)
  /** Days a spread task may use: working days (with grid hours for its area) up to deadline − slack, or N days. */
  const spreadDaysFor = (t: Task, c: CategoryPref) => {
    const from = earliestOf(t)
    const usable = days.filter((d) => dayWindow(d, c.window) && (quota(c, d) ?? 1) > 0 && (!from || isoDate(d) >= from))
    if (t.due) {
      const last = isoDate(new Date(new Date(t.due + 'T00:00:00').getTime() - prefs.deadlineSlackDays * DAY))
      const until = usable.filter((d) => isoDate(d) <= last)
      return until.length ? until : usable.slice(0, 1)
    }
    return usable.slice(0, st.spreadDays)
  }

  /** `leftover`: second pass, only on days where the task's area has 0 grid hours. */
  const placeTask = (t: Task, leftover = false) => {
    const c = catOf(t.category)
    const guarded = isGuarded(t)
    // Whole tasks (e.g. a training session) go into one block or not at all that day.
    const whole = Boolean(c.wholeTasks)
    const spread = !leftover && !whole && !guarded && (t.timing ?? c.timing ?? 'asap') === 'spread'
    const spreadSet = spread ? spreadDaysFor(t, c).map(isoDate) : []
    const minChunk = () => (whole ? remaining.get(t.id)! : Math.min(prefs.minChunkMinutes, remaining.get(t.id)!))
    const earliest = earliestOf(t)
    for (const day of days) {
      const dk = isoDate(day)
      if (earliest && dk < earliest) continue
      if (leftover && (quota(c, day) ?? 0) > 0) continue
      const lastSpreadDay = spreadSet[spreadSet.length - 1]
      // Spread: skip days outside the set until it's over; then fall back to as-soon-as-possible for leftovers.
      if (spread && dk <= lastSpreadDay && !spreadSet.includes(dk)) continue
      const spreadTarget = () => {
        const left = spreadSet.filter((d) => d >= dk).length
        if (!spread || !left || dk > lastSpreadDay) return Infinity
        const per = Math.ceil(remaining.get(t.id)! / left / prefs.slotMinutes) * prefs.slotMinutes
        return Math.max(per, prefs.minChunkMinutes)
      }
      const dayCap = () => Math.min(prefs.maxTaskMinutesPerDay, spreadTarget()) - (perDay.get(t.id)?.get(dk) ?? 0)
      const want = () => Math.min(remaining.get(t.id)!, dayCap())
      // 1–2: containers and free room in existing blocks, in time order.
      const roomy = blocks
        .filter((b) => !b.frozen && b.free > 0 && b.category === c.key && dayKey(b.s) === dk && (b.kind === 'container' || b.kind === 'proposed' || b.kind === 'topup' || b.fill))
        .sort((x, y) => x.s - y.s)
      for (const b of roomy) {
        if (want() <= 0) break
        const use = Math.min(want(), b.free)
        if (use >= minChunk() && !isExcluded(b.id, t.id)) assign(b, t.id, use)
      }
      // 3–4: grow a block or open a new one.
      while (want() > 0) {
        const room = Math.min(want(), allowance(c, day, guarded, leftover))
        if (room < minChunk()) break
        const canOpen = allowance(c, day, guarded, leftover) >= (c.minBlockMinutes ?? prefs.minChunkMinutes)
        const b = (whole ? null : grow(c, day, room, t.id)) ?? (canOpen ? open_(c, day, room, 'proposed', whole ? room : 0) : null)
        if (!b) break
        const use = Math.min(room, b.free)
        if (use < minChunk()) break
        assign(b, t.id, use)
      }
      if (remaining.get(t.id)! <= 0) break
    }
  }

  /** Warnings once every pass is done (a task the leftover pass placed isn't "doesn't fit"). */
  const warnFor = (t: Task) => {
    const c = catOf(t.category)
    const rem = remaining.get(t.id)!
    if (rem > 0) {
      const detail = `Doesn't fit in the next ${prefs.horizonDays} days: ${rem} min left unplanned.`
      warnings.push({ kind: 'unscheduled', taskId: t.id, category: c.key, detail, message: `“${t.title}” doesn't fit in the next ${prefs.horizonDays} days (${rem} min left).` })
    }
    if (isStale(t)) {
      const detail = `${daysOverdue(t)} days overdue (due ${t.due}), so it's planned last. Reschedule or drop it?`
      warnings.push({ kind: 'stale', taskId: t.id, category: c.key, detail, message: `“${t.title}” is ${daysOverdue(t)} days overdue: planned last. Reschedule or drop it?` })
    } else if (t.due) {
      const dueEnd = new Date(t.due + 'T00:00:00').getTime() + DAY
      const base = { kind: 'deadline' as const, taskId: t.id, category: c.key }
      if (dueEnd <= nowMs) warnings.push({ ...base, level: 'overdue', detail: `Overdue since ${t.due}.`, message: `“${t.title}” is overdue (due ${t.due}).` })
      else if (rem > 0 || (taskFinish[t.id] ?? 0) > dueEnd)
        warnings.push({ ...base, level: 'risk', detail: `The plan doesn't finish it before its deadline (${t.due}).`, message: `“${t.title}” won't be done before its deadline (${t.due}).` })
    }
  }

  // --- reserved grid hours (e.g. thesis deep work even without concrete tasks) ----------
  // Placed before other areas' tasks, so the reserve gets its preferred windows instead of the
  // leftovers; the area's own tasks then fill these blocks.
  const reserveGridHours = () => {
    for (const c of prefs.categories) {
      if (!c.reserveQuota) continue
      const minBlock = c.minBlockMinutes ?? prefs.minChunkMinutes
      for (const day of days) {
        const q = quota(c, day)
        if (q === null) continue
        let need = q - areaMinutes(c, day)
        while (need >= minBlock) {
          const room = Math.min(need, allowance(c, day), prefs.maxBlockMinutes)
          if (room < minBlock) break
          const b = grow(c, day, room) ?? open_(c, day, room, 'topup')
          if (!b) break
          need = q - areaMinutes(c, day)
        }
      }
    }
  }

  // Training first, like appointments; breaks float around it; deadlines due within the guard window;
  // then reserved hours claim their windows; then everything else.
  for (const t of queue) if (t.category === tc.key) placeTask(t)
  placeBreaks()
  for (const t of queue) if (t.category !== tc.key && isGuarded(t)) placeTask(t)
  reserveGridHours()
  for (const t of queue) if (t.category !== tc.key && !isGuarded(t)) placeTask(t)
  // Days with 0 grid hours for an area aren't closed to it: tasks still left (any area, and Other),
  // in the same priority order, may use time no area with hours that day took.
  if (prefs.allocation.enabled) for (const t of queue) if (t.category !== tc.key && remaining.get(t.id)! > 0) placeTask(t, true)
  for (const t of queue) warnFor(t)

  // --- weekly budgets -----------------------------------------------------------
  const weeksInHorizon = [...new Set(days.map((d) => isoWeek(d)))]
  for (const c of prefs.categories) {
    for (const week of weeksInHorizon) {
      const weekDays = days.filter((d) => isoWeek(d) === week)
      const min = c.budget?.minHours
      if (min !== undefined) {
        for (const day of weekDays) {
          let need = min * 60 - weekMinutes(week, c.key)
          while (need >= (c.minBlockMinutes ?? prefs.minChunkMinutes)) {
            const room = Math.min(need, allowance(c, day), prefs.maxBlockMinutes)
            if (room < (c.minBlockMinutes ?? prefs.minChunkMinutes)) break
            const b = grow(c, day, room) ?? open_(c, day, room, 'topup')
            if (!b) break
            need = min * 60 - weekMinutes(week, c.key)
          }
        }
        const total = weekMinutes(week, c.key)
        if (total < min * 60 && (weekDays.length === 7 || week === isoWeek(today)))
          warnings.push({ kind: 'budget-behind', category: c.key, message: `${c.label}: ${Math.round(total / 6) / 10}h planned for ${week}, target ${min}h.` })
      }
      const max = c.budget?.maxHours
      if (max !== undefined && weekMinutes(week, c.key) > max * 60)
        warnings.push({ kind: 'budget-over', category: c.key, message: `${c.label}: ${Math.round(weekMinutes(week, c.key) / 6) / 10}h in ${week}, above the ${max}h cap.` })
    }
  }

  // --- tidy: drop empty new blocks, trim unused tails ------------------------------
  const out = blocks.filter((b) => !(b.kind === 'proposed' && !b.frozen && b.chunks.length === 0 && b.e > nowMs))
  // A new training block with one session is named after it ("Back A + Triceps", not "Sport").
  const titleOf = new Map(tasks.map((t) => [t.id, t.title.replace(/\*\*|`/g, '')]))
  for (const b of out) if (b.category === tc.key && b.kind === 'proposed' && !b.anchored && b.chunks.length === 1) b.title = titleOf.get(b.chunks[0].taskId) ?? b.title
  for (const b of out) {
    if (b.kind !== 'proposed' || b.frozen || b.free <= 0) continue
    const used = b.chunks.reduce((s, c) => s + c.minutes, 0)
    const keep = Math.max(used, catOf(b.category).minBlockMinutes ?? prefs.minChunkMinutes)
    const len = Math.ceil(keep / prefs.slotMinutes) * prefs.slotMinutes
    if (len < (b.e - b.s) / MIN) {
      b.e = b.s + len * MIN
      b.end = localISO(new Date(b.e))
    }
  }

  return {
    generatedAt: now.toISOString(),
    mode: anchorFuture ? 'incremental' : 'full',
    fullPlannedAt: input.fullPlannedAt ?? now.toISOString(),
    blocks: out.sort((a, b) => a.s - b.s).map(({ s: _s, e: _e, free: _f, anchored: _a, frozen: _z, ...b }) => b),
    warnings,
    taskFinish: Object.fromEntries(Object.entries(taskFinish).map(([k, v]) => [k, localISO(new Date(v))])),
    ruleDays: days.flatMap((d) => rulesOn(d).map((r) => ({ day: isoDate(d), ruleId: r.id, label: r.label, ...(r.when === 'pick' ? { picked: true } : {}) })))
  }
}
