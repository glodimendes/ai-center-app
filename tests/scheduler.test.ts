import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CalEvent, Preferences, Task, WeekData } from '@shared/types'
import { plan } from '../electron/main/scheduler/plan'
import { parseTrainingPlan, sessionFor } from '../electron/main/vault/training'
import { DEFAULT_PREFERENCES } from '../electron/main/vault/preferences'
import { parseTasks } from '../electron/main/vault/parser'

// Monday 2026-11-09, 07:00 local.
const now = new Date(2026, 10, 9, 7, 0)
const training = parseTrainingPlan(readFileSync(join(__dirname, 'fixtures/hybrid-training.md'), 'utf8'))!
const prefs: Preferences = { ...DEFAULT_PREFERENCES, allocation: { ...DEFAULT_PREFERENCES.allocation, enabled: false }, categories: DEFAULT_PREFERENCES.categories.map((c) => ({ ...c, budget: undefined })) }

let n = 0
const task = (title: string, category: string, extra: Partial<Task> = {}): Task => ({
  id: `t${++n}`,
  file: 'x.md',
  line: n,
  indent: 0,
  title,
  done: false,
  section: [],
  category,
  priority: 'medium',
  childIds: [],
  ...extra
})

const ev = (title: string, calendarName: string, start: string, end: string, extra: Partial<CalEvent> = {}): CalEvent => ({
  id: title + start,
  calendarId: calendarName,
  calendarName,
  title,
  start,
  end,
  allDay: false,
  ...extra
})

const minsIn = (blocks: ReturnType<typeof plan>['blocks'], taskId: string) =>
  blocks.flatMap((b) => b.chunks).filter((c) => c.taskId === taskId).reduce((s, c) => s + c.minutes, 0)

describe('training plan', () => {
  it('parses the 7-day table and Day 7 rotation', () => {
    expect(training.days).toHaveLength(7)
    expect(training.days[0]).toMatchObject({ day: 1, session: 'Back A + Triceps', minutes: 70 })
    expect(training.day7Rotation.map((r) => r.rest)).toEqual([false, false, true])
  })

  it('computes the session for a date', () => {
    expect(sessionFor(training, '2026-11-02', new Date(2026, 10, 3))!.session).toMatch(/^Run/)
    expect(sessionFor(training, '2026-11-02', new Date(2026, 10, 8))!.session).toBe('threshold')
    expect(sessionFor(training, '2026-11-02', new Date(2026, 10, 15))!.session).toBe('long Z2 run')
    expect(sessionFor(training, '2026-11-02', new Date(2026, 10, 22))!.rest).toBe(true)
  })
})

describe('plan', () => {
  it('fills a matching container before proposing new blocks', () => {
    const t = task('Write pipeline', 'thesis', { estimateMin: 120 })
    const p = plan({
      tasks: [t],
      events: [ev('Thesis Deep Work', 'Study Schedule', '2026-11-09T08:30:00', '2026-11-09T11:30:00')],
      prefs,
      training: null,
      weeks: {},
      now
    })
    const container = p.blocks.find((b) => b.kind === 'container')!
    expect(container.chunks).toEqual([{ taskId: t.id, minutes: 120 }])
    expect(p.blocks.filter((b) => b.kind === 'proposed')).toHaveLength(0)
  })

  it('puts guarded deadlines first, then ranks by weighted score', () => {
    const late = task('Late', 'thesis', { estimateMin: 60, due: '2026-11-20' })
    const soon = task('Soon', 'thesis', { estimateMin: 60, due: '2026-11-10' })
    const high = task('High no due', 'thesis', { estimateMin: 60, priority: 'high' })
    const p = plan({
      tasks: [late, high, soon],
      events: [ev('Thesis Deep Work', 'Study Schedule', '2026-11-09T08:00:00', '2026-11-09T09:00:00')],
      prefs,
      training: null,
      weeks: {},
      now
    })
    expect(p.blocks.find((b) => b.kind === 'container')!.chunks[0].taskId).toBe(soon.id)
    // A far deadline scores below an undated high-priority task.
    expect(p.taskFinish[high.id] <= p.taskFinish[late.id]).toBe(true)
  })

  it('splits a long task into chunks and never overlaps busy events', () => {
    const t = task('Big', 'thesis', { estimateMin: 600 })
    const lecture = ev('RTAI Lecture', 'ETH Classes HS26', '2026-11-09T10:00:00', '2026-11-09T12:00:00')
    const p = plan({ tasks: [t], events: [lecture], prefs, training: null, weeks: {}, now })
    expect(minsIn(p.blocks, t.id)).toBe(600)
    for (const b of p.blocks) {
      const s = new Date(b.start).getTime()
      const e = new Date(b.end).getTime()
      expect(s < new Date(lecture.end).getTime() && e > new Date(lecture.start).getTime()).toBe(false)
      expect((e - s) / 60000).toBeLessThanOrEqual(180)
    }
  })

  it('respects the daily deep-work cap', () => {
    const t = task('Huge', 'thesis', { estimateMin: 1200 })
    const p = plan({ tasks: [t], events: [], prefs, training: null, weeks: {}, now })
    const monday = p.blocks.filter((b) => b.start.startsWith('2026-11-09'))
    const total = monday.reduce((s, b) => s + (new Date(b.end).getTime() - new Date(b.start).getTime()) / 60000, 0)
    expect(total).toBeLessThanOrEqual(prefs.maxDeepWorkMinutesPerDay)
  })

  it('keeps pinned blocks fixed and counts their tasks', () => {
    const t = task('Pinned task', 'outside', { estimateMin: 60 })
    const weeks: Record<string, WeekData> = {
      '2026-W46': {
        week: '2026-W46',
        log: [],
        pins: [{ blockId: 'pin:1', category: 'outside', title: 'Outside Work', start: '2026-11-09T14:00:00', end: '2026-11-09T15:00:00', taskIds: [t.id] }]
      }
    }
    const p = plan({ tasks: [t], events: [], prefs, training: null, weeks, now })
    const pin = p.blocks.find((b) => b.id === 'pin:1')!
    expect(pin.start).toBe('2026-11-09T14:00:00')
    expect(minsIn(p.blocks, t.id)).toBe(60)
  })

  it('labels an existing Sports event with the session, or proposes one', () => {
    const p = plan({
      tasks: [],
      events: [ev('Sport', 'Sports', '2026-11-09T07:30:00', '2026-11-09T08:30:00')],
      prefs,
      training,
      weeks: {},
      now
    })
    expect(p.blocks.find((b) => b.kind === 'container')!.trainingSession).toBe('Back A + Triceps')
    const tue = p.blocks.find((b) => b.id === 'train:2026-11-10')!
    expect(tue.calendarName).toBe('Sports')
    expect(tue.start >= '2026-11-10T18:00:00').toBe(true)
  })

  it('warns when a deadline cannot be met', () => {
    const t = task('Too big', 'thesis', { estimateMin: 900, due: '2026-11-09' })
    const p = plan({ tasks: [t], events: [], prefs, training: null, weeks: {}, now })
    expect(p.warnings.some((w) => w.kind === 'deadline' && w.taskId === t.id)).toBe(true)
  })

  it('tops up a weekly minimum and caps a weekly maximum', () => {
    const budgeted: Preferences = {
      ...prefs,
      categories: prefs.categories.map((c) =>
        c.key === 'thesis' ? { ...c, budget: { minHours: 18 } } : c.key === 'outside' ? { ...c, budget: { maxHours: 2 } } : c
      )
    }
    const outside = Array.from({ length: 8 }, (_, i) => task(`O${i}`, 'outside', { estimateMin: 30 }))
    const p = plan({ tasks: outside, events: [], prefs: budgeted, training: null, weeks: {}, now })
    const thisWeek = (cat: string) =>
      p.blocks
        .filter((b) => b.category === cat && b.start < '2026-11-16')
        .reduce((s, b) => s + (new Date(b.end).getTime() - new Date(b.start).getTime()) / 60000, 0)
    expect(thisWeek('thesis')).toBeGreaterThanOrEqual(18 * 60)
    expect(thisWeek('outside')).toBeLessThanOrEqual(120)
  })

  it('plans the real todo list without crashing and schedules every open leaf task', () => {
    const today = new Date(2026, 10, 9)
    const text = readFileSync(join(__dirname, 'fixtures/daily-todos.md'), 'utf8')
    const { tasks } = parseTasks(text, 'f', DEFAULT_PREFERENCES.categories, today)
    const p = plan({ tasks, events: [], prefs: DEFAULT_PREFERENCES, training, weeks: {}, now })
    expect(p.blocks.length).toBeGreaterThan(10)
    const starts = p.blocks.map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()]).sort((a, b) => a[0] - b[0])
    for (let i = 1; i < starts.length; i++) expect(starts[i][0]).toBeGreaterThanOrEqual(starts[i - 1][1])
  })
})

describe('finer rules', () => {
  const D = DEFAULT_PREFERENCES
  const len = (b: { start: string; end: string }) => (new Date(b.end).getTime() - new Date(b.start).getTime()) / 60000
  const work = (p: ReturnType<typeof plan>, day: string) => p.blocks.filter((b) => b.start.startsWith(day) && ['proposed', 'topup', 'container', 'pinned'].includes(b.kind))
  const noBudgets: Preferences = { ...D, allocation: { ...D.allocation, enabled: false }, categories: D.categories.map((c) => ({ ...c, budget: undefined })) }

  it('puts thesis in the morning and outside work in the afternoon (preferred windows)', () => {
    const th = task('Thesis piece', 'thesis', { estimateMin: 120 })
    const ow = task('Email', 'outside', { estimateMin: 60 })
    const p = plan({ tasks: [ow, th], events: [], prefs: noBudgets, training: null, weeks: {}, now })
    const tb = p.blocks.find((b) => b.chunks.some((c) => c.taskId === th.id))!
    const ob = p.blocks.find((b) => b.chunks.some((c) => c.taskId === ow.id))!
    expect(tb.start.slice(11, 16) >= '08:00' && tb.end.slice(11, 16) <= '12:30').toBe(true)
    expect(ob.start.slice(11, 16) >= '14:00').toBe(true)
  })

  it('protects a floating lunch break', () => {
    const p = plan({ tasks: [task('Long', 'thesis', { estimateMin: 600 })], events: [], prefs: noBudgets, training: null, weeks: {}, now })
    const lunch = p.blocks.find((b) => b.kind === 'break' && b.title === 'Lunch' && b.start.startsWith('2026-11-09'))!
    expect(lunch.start.slice(11, 16) >= '12:00' && lunch.end.slice(11, 16) <= '14:00').toBe(true)
    for (const b of p.blocks.filter((x) => x.kind !== 'break')) expect(new Date(b.start) < new Date(lunch.end) && new Date(b.end) > new Date(lunch.start)).toBe(false)
  })

  it('caps planned work per day and spreads one big task over days', () => {
    const many = Array.from({ length: 12 }, (_, i) => task(`O${i}`, 'courses', { estimateMin: 90 }))
    const big = task('Big', 'thesis', { estimateMin: 600 })
    const p = plan({ tasks: [big, ...many], events: [], prefs: noBudgets, training: null, weeks: {}, now })
    expect(work(p, '2026-11-09').reduce((s, b) => s + len(b), 0)).toBeLessThanOrEqual(D.dailyMaxMinutes.weekday)
    const bigMonday = p.blocks.filter((b) => b.start.startsWith('2026-11-09')).flatMap((b) => b.chunks).filter((c) => c.taskId === big.id).reduce((s, c) => s + c.minutes, 0)
    expect(bigMonday).toBeLessThanOrEqual(D.maxTaskMinutesPerDay)
  })

  it('batches small tasks into one block instead of many fragments', () => {
    const small = Array.from({ length: 4 }, (_, i) => task(`P${i}`, 'personal', { estimateMin: 15 }))
    const p = plan({ tasks: small, events: [], prefs: noBudgets, training: null, weeks: {}, now })
    const personal = p.blocks.filter((b) => b.category === 'personal')
    expect(personal).toHaveLength(1)
    expect(personal[0].chunks).toHaveLength(4)
  })

  it('plans stale overdue tasks after fresh work and flags them', () => {
    const stale = task('Old paper', 'courses', { estimateMin: 60, due: '2026-09-01' })
    const fresh = task('New exercise', 'courses', { estimateMin: 60 })
    const p = plan({ tasks: [stale, fresh], events: [], prefs: noBudgets, training: null, weeks: {}, now })
    expect(p.taskFinish[fresh.id] <= p.taskFinish[stale.id]).toBe(true)
    expect(p.warnings.some((w) => w.kind === 'stale' && w.taskId === stale.id)).toBe(true)
  })

  it('keeps a gap after deep work and around training', () => {
    const p = plan({ tasks: [task('T', 'thesis', { estimateMin: 600 }), task('C', 'courses', { estimateMin: 600 })], events: [], prefs: noBudgets, training, weeks: {}, now })
    const mon = p.blocks.filter((b) => b.start.startsWith('2026-11-09') && b.kind !== 'break').sort((a, b) => a.start.localeCompare(b.start))
    for (let i = 1; i < mon.length; i++) {
      const gap = (new Date(mon[i].start).getTime() - new Date(mon[i - 1].end).getTime()) / 60000
      const deep = ['thesis', 'courses'].includes(mon[i - 1].category) || mon[i - 1].kind === 'training' || mon[i].kind === 'training'
      expect(gap).toBeGreaterThanOrEqual(deep ? 30 : 15)
    }
  })
})

describe('stable re-planning', () => {
  const D = DEFAULT_PREFERENCES
  const base = [task('Thesis A', 'thesis', { estimateMin: 120 }), task('Course B', 'courses', { estimateMin: 90 }), task('Mail C', 'outside', { estimateMin: 30 })]
  const first = plan({ tasks: base, events: [], prefs: D, training, weeks: {}, now })
  const positions = (p: ReturnType<typeof plan>) => p.blocks.filter((b) => b.kind !== 'container').map((b) => `${b.id}@${b.start}`)

  it('adding a task does not move existing blocks', () => {
    const extra = task('New thing', 'outside', { estimateMin: 30 })
    const next = plan({ tasks: [...base, extra], events: [], prefs: D, training, weeks: {}, now, previous: first })
    const before = new Set(positions(first).filter((x) => !x.includes(':outside:')))
    for (const pos of before) expect(positions(next)).toContain(pos)
    expect(next.mode).toBe('incremental')
  })

  it('completing a task frees its block without reshuffling the rest', () => {
    const done = base.map((t) => (t.title === 'Mail C' ? { ...t, done: true } : t))
    const next = plan({ tasks: done, events: [], prefs: D, training, weeks: {}, now, previous: first })
    const thesisBefore = first.blocks.find((b) => b.chunks.some((c) => c.taskId === base[0].id))!
    expect(next.blocks.find((b) => b.id === thesisBefore.id)?.start).toBe(thesisBefore.start)
    expect(next.blocks.some((b) => b.chunks.some((c) => c.taskId === base[2].id))).toBe(false)
  })

  it('a new calendar event only displaces the block it collides with', () => {
    const thesisBlock = first.blocks.find((b) => b.chunks.some((c) => c.taskId === base[0].id))!
    const meeting = ev('Meeting', 'Personal', thesisBlock.start, thesisBlock.end)
    const next = plan({ tasks: base, events: [meeting], prefs: D, training, weeks: {}, now, previous: first })
    const moved = next.blocks.find((b) => b.chunks.some((c) => c.taskId === base[0].id))!
    expect(new Date(moved.start) >= new Date(meeting.end) || new Date(moved.end) <= new Date(meeting.start)).toBe(true)
    expect(next.warnings.some((w) => w.kind === 'conflict')).toBe(true)
    const others = first.blocks.filter((b) => b.id !== thesisBlock.id && b.kind === 'training')
    for (const o of others) expect(next.blocks.find((b) => b.id === o.id)?.start).toBe(o.start)
  })

  it('blocks already started stay as they were', () => {
    const later = new Date(2026, 10, 9, 12, 0)
    const started = first.blocks.find((b) => b.start.startsWith('2026-11-09') && b.kind === 'proposed' && new Date(b.start) < later)!
    const next = plan({ tasks: base, events: [], prefs: D, training, weeks: {}, now: later, previous: first })
    expect(next.blocks.find((b) => b.id === started.id)?.start).toBe(started.start)
  })
})

describe('chunks', () => {
  it('lists a task once per block even when it is filled in two steps', () => {
    const p = plan({ tasks: [task('Long thesis', 'thesis', { estimateMin: 240 })], events: [ev('Thesis Deep Work', 'Study Schedule', '2026-11-09T13:30:00', '2026-11-09T14:00:00')], prefs: DEFAULT_PREFERENCES, training: null, weeks: {}, now })
    for (const b of p.blocks) expect(new Set(b.chunks.map((c) => c.taskId)).size).toBe(b.chunks.length)
  })
})

describe('strategy', () => {
  const D = DEFAULT_PREFERENCES
  const minutes = (p: ReturnType<typeof plan>, cat: string, day: string) =>
    p.blocks.filter((b) => b.category === cat && b.start.startsWith(day) && b.kind !== 'break').reduce((s, b) => s + (new Date(b.end).getTime() - new Date(b.start).getTime()) / 60000, 0)

  it('weighs areas: thesis outranks equal outside work', () => {
    const o = task('Outside', 'outside', { estimateMin: 60, priority: 'high' })
    const t = task('Thesis', 'thesis', { estimateMin: 60, priority: 'high' })
    const p = plan({ tasks: [o, t], events: [], prefs: { ...D, allocation: { ...D.allocation, enabled: false } }, training: null, weeks: {}, now })
    expect(p.taskFinish[t.id] <= p.taskFinish[o.id]).toBe(true)
  })

  it('keeps each area within its grid hours for the day', () => {
    const courses = Array.from({ length: 6 }, (_, i) => task(`C${i}`, 'courses', { estimateMin: 60 }))
    const p = plan({ tasks: courses, events: [], prefs: D, training: null, weeks: {}, now })
    expect(minutes(p, 'courses', '2026-11-09')).toBeLessThanOrEqual(120) // Mon: 2h
    expect(minutes(p, 'courses', '2026-11-10')).toBeLessThanOrEqual(180) // Tue: 3h
    expect(minutes(p, 'courses', '2026-11-15')).toBe(0) // Sun: none
  })

  it('reserves thesis grid hours even without tasks', () => {
    const p = plan({ tasks: [], events: [], prefs: D, training: null, weeks: {}, now })
    expect(minutes(p, 'thesis', '2026-11-09')).toBe(240)
    expect(minutes(p, 'thesis', '2026-11-10')).toBe(120)
  })

  it('lets a guarded deadline exceed the grid', () => {
    const urgent = task('Urgent course hand-in', 'courses', { estimateMin: 180, due: '2026-11-09' })
    const p = plan({ tasks: [urgent], events: [], prefs: D, training: null, weeks: {}, now })
    expect(minutes(p, 'courses', '2026-11-09')).toBeGreaterThan(120)
  })

  it('spreads an @spread task evenly until its deadline instead of front-loading', () => {
    const noGrid = { ...D, allocation: { ...D.allocation, enabled: false } }
    const big = task('Write chapter', 'thesis', { estimateMin: 480, due: '2026-11-14', timing: 'spread' })
    const p = plan({ tasks: [big], events: [], prefs: noGrid, training: null, weeks: {}, now })
    const per = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((d) =>
      p.blocks.filter((b) => b.start.startsWith(d)).flatMap((b) => b.chunks).filter((c) => c.taskId === big.id).reduce((s, c) => s + c.minutes, 0)
    )
    expect(per.every((m) => m > 0 && m <= 120)).toBe(true)
    const asap = plan({ tasks: [{ ...big, timing: 'asap' }], events: [], prefs: noGrid, training: null, weeks: {}, now })
    const monday = asap.blocks.filter((b) => b.start.startsWith('2026-11-09')).flatMap((b) => b.chunks).reduce((s, c) => s + c.minutes, 0)
    expect(monday).toBeGreaterThan(per[0])
  })
})

describe('calendar edits win', () => {
  it('does not recreate a block or training session the user deleted', () => {
    const t = task('Thesis A', 'thesis', { estimateMin: 120 })
    const first = plan({ tasks: [t], events: [], prefs, training, weeks: {}, now })
    const gone = first.blocks.find((b) => b.chunks.some((c) => c.taskId === t.id))!
    const next = plan({ tasks: [t], events: [], prefs, training, weeks: {}, now, previous: first, excludeIds: [gone.id, 'train:2026-11-10'] })
    expect(next.blocks.some((b) => b.id === gone.id)).toBe(false)
    expect(next.blocks.some((b) => b.chunks.some((c) => c.taskId === t.id))).toBe(true)
    expect(next.blocks.some((b) => b.id === 'train:2026-11-10')).toBe(false)
  })
})

describe('busy / free events', () => {
  // A long Monday event: busy → no work may overlap it; free → the planner schedules over it.
  const long = (extra: Partial<CalEvent> = {}) => ev('Hackathon', 'ETH Classes HS26', '2026-11-09T07:00:00', '2026-11-09T20:00:00', extra)
  const overlapsEvent = (p: ReturnType<typeof plan>, e: CalEvent) =>
    p.blocks.some((b) => b.kind !== 'break' && new Date(b.start).getTime() < new Date(e.end).getTime() && new Date(b.end).getTime() > new Date(e.start).getTime())
  const run = (e: CalEvent, extra: Partial<Parameters<typeof plan>[0]> = {}) =>
    plan({ tasks: [task('Big', 'thesis', { estimateMin: 600 })], events: [e], prefs, training: null, weeks: {}, now, ...extra })

  it('a busy event blocks time', () => {
    expect(overlapsEvent(run(long()), long())).toBe(false)
  })

  it('a free event does not block time (calendar flag, override, ignored calendar)', () => {
    const flagged = long({ free: true })
    expect(overlapsEvent(run(flagged), flagged)).toBe(true)
    const plain = long()
    expect(overlapsEvent(run(plain, { eventAvailability: { [`${plain.calendarId}:${plain.id}`]: 'free' } }), plain)).toBe(true)
    expect(overlapsEvent(run(plain, { prefs: { ...prefs, ignoreCalendars: [plain.calendarName] } }), plain)).toBe(true)
  })

  it('a busy override wins over the calendar marking it free', () => {
    const flagged = long({ free: true })
    expect(overlapsEvent(run(flagged, { eventAvailability: { [`${flagged.calendarId}:${flagged.id}`]: 'busy' } }), flagged)).toBe(false)
  })

  it('a free event titled like a container is not a container', () => {
    const e = ev('Thesis Deep Work', 'Study Schedule', '2026-11-09T08:30:00', '2026-11-09T11:30:00', { free: true })
    const p = run(e)
    expect(p.blocks.some((b) => b.kind === 'container' || b.eventId === e.id)).toBe(false)
  })
})

describe('manual block edits (weekly overrides)', () => {
  const container = () => ev('Thesis Deep Work', 'Study Schedule', '2026-11-09T08:30:00', '2026-11-09T11:30:00')
  const cid = `evt:${container().id}`
  const week = (overrides: WeekData['overrides']): Record<string, WeekData> => ({ '2026-W46': { week: '2026-W46', log: [], pins: [], overrides } })

  it('puts an assigned task into its container first', () => {
    const first = task('Urgent first', 'thesis', { estimateMin: 120, priority: 'high' })
    const mine = task('Assigned', 'thesis', { estimateMin: 120, priority: 'low' })
    const base = { tasks: [first, mine], events: [container()], prefs, training: null, now }
    const without = plan({ ...base, weeks: {} }).blocks.find((b) => b.id === cid)!
    expect(without.chunks[0]).toEqual({ taskId: first.id, minutes: 120 })
    const p = plan({ ...base, weeks: week({ assignments: [{ blockId: cid, taskIds: [mine.id] }] }) })
    const c = p.blocks.find((b) => b.id === cid)!
    expect(c.chunks[0]).toEqual({ taskId: mine.id, minutes: 120 })
    expect(minsIn(p.blocks, first.id)).toBe(120)
  })

  it('keeps an excluded task out of a block', () => {
    const t = task('Not here', 'thesis', { estimateMin: 120 })
    const p = plan({ tasks: [t], events: [container()], prefs, training: null, now, weeks: week({ exclusions: [{ blockId: cid, taskId: t.id }] }) })
    expect(p.blocks.find((b) => b.id === cid)!.chunks).toHaveLength(0)
    expect(minsIn(p.blocks, t.id)).toBe(120)
  })

  it('does not recreate a dismissed proposed block under its id', () => {
    const t = task('Thesis B', 'thesis', { estimateMin: 120 })
    const first = plan({ tasks: [t], events: [], prefs, training: null, weeks: {}, now })
    const gone = first.blocks.find((b) => b.kind === 'proposed' && b.chunks.some((c) => c.taskId === t.id))!
    for (const anchorFuture of [true, false]) {
      const next = plan({ tasks: [t], events: [], prefs, training: null, now, previous: first, anchorFuture, weeks: week({ dismissed: [gone.id] }) })
      expect(next.blocks.some((b) => b.id === gone.id)).toBe(false)
      expect(minsIn(next.blocks, t.id)).toBe(120)
    }
  })

  it('does not fill a dismissed container (it stays busy)', () => {
    const t = task('Thesis C', 'thesis', { estimateMin: 120 })
    const p = plan({ tasks: [t], events: [container()], prefs, training: null, now, weeks: week({ dismissed: [cid] }) })
    const c = p.blocks.find((b) => b.id === cid)!
    expect(c.chunks).toHaveLength(0)
    expect(minsIn(p.blocks, t.id)).toBe(120)
    const s = new Date(c.start).getTime()
    const e = new Date(c.end).getTime()
    expect(p.blocks.filter((b) => b.id !== cid && new Date(b.start).getTime() < e && new Date(b.end).getTime() > s)).toHaveLength(0)
  })

  it('does not re-add a dismissed break that day', () => {
    const br = prefs.breaks[0]
    if (!br) return
    const id = `break:2026-11-09:${br.label}`
    const p = plan({ tasks: [], events: [], prefs, training: null, now, weeks: week({ dismissed: [id] }) })
    expect(p.blocks.some((b) => b.id === id)).toBe(false)
    expect(p.blocks.some((b) => b.id === `break:2026-11-10:${br.label}`)).toBe(true)
  })
})
