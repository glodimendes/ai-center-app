import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CalEvent, Preferences, Task, WeekData } from '@shared/types'
import { plan } from '../electron/main/scheduler/plan'
import { DEFAULT_PREFERENCES } from '../electron/main/vault/preferences'
import { parseTasks } from '../electron/main/vault/parser'
import { applyVariant, planMetrics } from '../electron/main/scheduler/variants'

// Monday 2026-11-09, 07:00 local.
const now = new Date(2026, 10, 9, 7, 0)
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

describe('plan', () => {
  it('fills a matching container before proposing new blocks', () => {
    const t = task('Write pipeline', 'thesis', { estimateMin: 120 })
    const p = plan({
      tasks: [t],
      events: [ev('Thesis Deep Work', 'Study Schedule', '2026-11-09T08:30:00', '2026-11-09T11:30:00')],
      prefs,
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
      weeks: {},
      now
    })
    expect(p.blocks.find((b) => b.kind === 'container')!.chunks[0].taskId).toBe(soon.id)
    // A far deadline scores below an undated high-priority task.
    expect(p.taskFinish[high.id] <= p.taskFinish[late.id]).toBe(true)
  })

  it('ranks urgent above high priority', () => {
    const high = task('High', 'thesis', { estimateMin: 60, priority: 'high' })
    const urgent = task('Urgent', 'thesis', { estimateMin: 60, priority: 'urgent' })
    const p = plan({ tasks: [high, urgent], events: [], prefs, weeks: {}, now })
    expect(p.taskFinish[urgent.id] < p.taskFinish[high.id]).toBe(true)
  })

  it('splits a long task into chunks and never overlaps busy events', () => {
    const t = task('Big', 'thesis', { estimateMin: 600 })
    const lecture = ev('RTAI Lecture', 'ETH Classes HS26', '2026-11-09T10:00:00', '2026-11-09T12:00:00')
    const p = plan({ tasks: [t], events: [lecture], prefs, weeks: {}, now })
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
    const p = plan({ tasks: [t], events: [], prefs, weeks: {}, now })
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
    const p = plan({ tasks: [t], events: [], prefs, weeks, now })
    const pin = p.blocks.find((b) => b.id === 'pin:1')!
    expect(pin.start).toBe('2026-11-09T14:00:00')
    expect(minsIn(p.blocks, t.id)).toBe(60)
  })

  it('fills an existing Sports event with a training task and names new training blocks after the session', () => {
    const lift = task('Back A + Triceps', 'training', { estimateMin: 60 })
    const run = task('Run Z2', 'training', { estimateMin: 45 })
    const p = plan({ tasks: [lift, run], events: [ev('Sport', 'Sports', '2026-11-09T07:30:00', '2026-11-09T08:30:00')], prefs, weeks: {}, now })
    expect(p.blocks.find((b) => b.kind === 'container')!.chunks).toEqual([{ taskId: lift.id, minutes: 60 }])
    const runBlock = p.blocks.find((b) => b.chunks.some((c) => c.taskId === run.id))!
    expect(runBlock).toMatchObject({ title: 'Run Z2', calendarName: 'Sports' })
  })

  it('a postponed task is not planned before its date', () => {
    const t = task('Later', 'outside', { estimateMin: 30, postponed: '2026-11-12' })
    const p = plan({ tasks: [t], events: [], prefs, weeks: {}, now })
    expect(p.blocks.find((b) => b.chunks.some((c) => c.taskId === t.id))!.start.slice(0, 10)).toBe('2026-11-12')
  })

  it('keeps a training session in one block and lets dinner float around it', () => {
    const lift = task('Back A + Triceps', 'training', { estimateMin: 70, due: '2026-11-09', repeat: 'mon' })
    const p = plan({ tasks: [lift], events: [], prefs: DEFAULT_PREFERENCES, weeks: {}, now })
    const mine = p.blocks.filter((b) => b.chunks.some((c) => c.taskId === lift.id))
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ start: '2026-11-09T18:00:00', end: '2026-11-09T19:15:00', title: 'Back A + Triceps' })
    const dinner = p.blocks.find((b) => b.id === 'break:2026-11-09:Dinner')!
    expect(new Date(dinner.start) >= new Date('2026-11-09T19:45:00')).toBe(true)
  })

  it('fills a drawn block with its area’s tasks, except ones taken out of it', () => {
    const a = task('Draft A', 'thesis', { estimateMin: 60 })
    const b = task('Draft B', 'thesis', { estimateMin: 60 })
    const pin = { blockId: 'pin:drawn', category: 'thesis', title: 'Thesis Deep Work', start: '2026-11-09T09:00:00', end: '2026-11-09T11:00:00', taskIds: [], fill: true }
    const weeks = (exclusions: { blockId: string; taskId: string }[] = []) => ({ '2026-W46': { week: '2026-W46', log: [], pins: [pin], overrides: { exclusions } } })
    const p = plan({ tasks: [a, b], events: [], prefs, weeks: weeks(), now })
    expect(p.blocks.find((x) => x.id === 'pin:drawn')!.chunks.map((c) => c.taskId).sort()).toEqual([a.id, b.id].sort())
    const q = plan({ tasks: [a, b], events: [], prefs, weeks: weeks([{ blockId: 'pin:drawn', taskId: b.id }]), now })
    expect(q.blocks.find((x) => x.id === 'pin:drawn')!.chunks.map((c) => c.taskId)).toEqual([a.id])
  })

  it('a block with no area holds its time but is neither filled nor counted as work', () => {
    const capped = { ...prefs, dailyMaxMinutes: { weekday: 60, weekend: 60 } }
    const t = task('Mail', 'outside', { estimateMin: 60 })
    const pin = { blockId: 'pin:doc', category: 'none', title: 'Doctor', start: '2026-11-09T09:00:00', end: '2026-11-09T11:00:00', taskIds: [] }
    const p = plan({ tasks: [t], events: [], prefs: capped, weeks: { '2026-W46': { week: '2026-W46', log: [], pins: [pin] } }, now })
    const doc = p.blocks.find((b) => b.id === 'pin:doc')!
    expect(doc.chunks).toEqual([])
    expect(doc.calendarName).toBe('Personal')
    const mail = p.blocks.find((b) => b.chunks.some((c) => c.taskId === t.id))!
    expect(mail.start.slice(0, 10)).toBe('2026-11-09') // the 2h appointment didn't use up the 1h daily cap
    expect(new Date(mail.end) <= new Date(doc.start) || new Date(mail.start) >= new Date(doc.end)).toBe(true)
  })

  it('a task postponed past a pinned block leaves it', () => {
    const t = task('Pinned then postponed', 'outside', { estimateMin: 30, postponed: '2026-11-12' })
    const pin = { blockId: 'pin:p', category: 'outside', title: 'Outside Work', start: '2026-11-09T14:00:00', end: '2026-11-09T15:00:00', taskIds: [t.id] }
    const p = plan({ tasks: [t], events: [], prefs, weeks: { '2026-W46': { week: '2026-W46', log: [], pins: [pin] } }, now })
    expect(p.blocks.find((b) => b.id === 'pin:p')!.chunks).toEqual([])
    expect(p.blocks.find((b) => b.chunks.some((c) => c.taskId === t.id))!.start.slice(0, 10)).toBe('2026-11-12')
  })

  it('no warning just for finishing close to the deadline', () => {
    const t = task('Tight', 'outside', { estimateMin: 30, due: '2026-11-10' })
    const p = plan({ tasks: [t], events: [], prefs, weeks: {}, now })
    expect(p.warnings.filter((w) => w.taskId === t.id)).toEqual([])
  })

  it('training stays outside the daily work cap', () => {
    const capped = { ...prefs, dailyMaxMinutes: { weekday: 60, weekend: 60 } }
    const work = task('Mail', 'outside', { estimateMin: 60 })
    const lift = task('Lift', 'training', { estimateMin: 60 })
    const p = plan({ tasks: [work, lift], events: [], prefs: capped, weeks: {}, now })
    const mon = p.blocks.filter((b) => b.start.startsWith('2026-11-09'))
    expect(mon.some((b) => b.chunks.some((c) => c.taskId === lift.id))).toBe(true)
    expect(mon.some((b) => b.chunks.some((c) => c.taskId === work.id))).toBe(true)
  })

  it('plans a weekday repeat on its day and an interval repeat within its period', () => {
    const onThu = task('Chest + Biceps', 'training', { estimateMin: 60, due: '2026-11-12', repeat: 'thu' })
    const weekly = task('Long run', 'training', { estimateMin: 60, due: '2026-11-22', repeat: 'weekly' })
    const p = plan({ tasks: [onThu, weekly], events: [], prefs, weeks: {}, now })
    const day = (id: string) => p.blocks.find((b) => b.chunks.some((c) => c.taskId === id))!.start.slice(0, 10)
    expect(day(onThu.id)).toBe('2026-11-12')
    expect(day(weekly.id)).toBe('2026-11-16') // not before the period that ends on 22/11
  })

  it('warns when a deadline cannot be met', () => {
    const t = task('Too big', 'thesis', { estimateMin: 900, due: '2026-11-09' })
    const p = plan({ tasks: [t], events: [], prefs, weeks: {}, now })
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
    const p = plan({ tasks: outside, events: [], prefs: budgeted, weeks: {}, now })
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
    const p = plan({ tasks, events: [], prefs: DEFAULT_PREFERENCES, weeks: {}, now })
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
    const p = plan({ tasks: [ow, th], events: [], prefs: noBudgets, weeks: {}, now })
    const tb = p.blocks.find((b) => b.chunks.some((c) => c.taskId === th.id))!
    const ob = p.blocks.find((b) => b.chunks.some((c) => c.taskId === ow.id))!
    expect(tb.start.slice(11, 16) >= '08:00' && tb.end.slice(11, 16) <= '12:30').toBe(true)
    expect(ob.start.slice(11, 16) >= '14:00').toBe(true)
  })

  it('protects a floating lunch break', () => {
    const p = plan({ tasks: [task('Long', 'thesis', { estimateMin: 600 })], events: [], prefs: noBudgets, weeks: {}, now })
    const lunch = p.blocks.find((b) => b.kind === 'break' && b.title === 'Lunch' && b.start.startsWith('2026-11-09'))!
    expect(lunch.start.slice(11, 16) >= '12:00' && lunch.end.slice(11, 16) <= '14:00').toBe(true)
    for (const b of p.blocks.filter((x) => x.kind !== 'break')) expect(new Date(b.start) < new Date(lunch.end) && new Date(b.end) > new Date(lunch.start)).toBe(false)
  })

  it('caps planned work per day and spreads one big task over days', () => {
    const many = Array.from({ length: 12 }, (_, i) => task(`O${i}`, 'courses', { estimateMin: 90 }))
    const big = task('Big', 'thesis', { estimateMin: 600 })
    const p = plan({ tasks: [big, ...many], events: [], prefs: noBudgets, weeks: {}, now })
    expect(work(p, '2026-11-09').reduce((s, b) => s + len(b), 0)).toBeLessThanOrEqual(D.dailyMaxMinutes.weekday)
    const bigMonday = p.blocks.filter((b) => b.start.startsWith('2026-11-09')).flatMap((b) => b.chunks).filter((c) => c.taskId === big.id).reduce((s, c) => s + c.minutes, 0)
    expect(bigMonday).toBeLessThanOrEqual(D.maxTaskMinutesPerDay)
  })

  it('batches small tasks into one block instead of many fragments', () => {
    const small = Array.from({ length: 4 }, (_, i) => task(`P${i}`, 'personal', { estimateMin: 15 }))
    const p = plan({ tasks: small, events: [], prefs: noBudgets, weeks: {}, now })
    const personal = p.blocks.filter((b) => b.category === 'personal')
    expect(personal).toHaveLength(1)
    expect(personal[0].chunks).toHaveLength(4)
  })

  it('plans stale overdue tasks after fresh work and flags them', () => {
    const stale = task('Old paper', 'courses', { estimateMin: 60, due: '2026-09-01' })
    const fresh = task('New exercise', 'courses', { estimateMin: 60 })
    const p = plan({ tasks: [stale, fresh], events: [], prefs: noBudgets, weeks: {}, now })
    expect(p.taskFinish[fresh.id] <= p.taskFinish[stale.id]).toBe(true)
    expect(p.warnings.some((w) => w.kind === 'stale' && w.taskId === stale.id)).toBe(true)
  })

  it('keeps a gap after deep work and around training', () => {
    const p = plan({ tasks: [task('T', 'thesis', { estimateMin: 600 }), task('C', 'courses', { estimateMin: 600 })], events: [], prefs: noBudgets, weeks: {}, now })
    const mon = p.blocks.filter((b) => b.start.startsWith('2026-11-09') && b.kind !== 'break').sort((a, b) => a.start.localeCompare(b.start))
    for (let i = 1; i < mon.length; i++) {
      const gap = (new Date(mon[i].start).getTime() - new Date(mon[i - 1].end).getTime()) / 60000
      const deep = ['thesis', 'courses'].includes(mon[i - 1].category) || [mon[i - 1].category, mon[i].category].includes('training')
      expect(gap).toBeGreaterThanOrEqual(deep ? 30 : 15)
    }
  })
})

describe('stable re-planning', () => {
  const D = DEFAULT_PREFERENCES
  const base = [task('Thesis A', 'thesis', { estimateMin: 120 }), task('Course B', 'courses', { estimateMin: 90 }), task('Mail C', 'outside', { estimateMin: 30 })]
  const first = plan({ tasks: base, events: [], prefs: D, weeks: {}, now })
  const positions = (p: ReturnType<typeof plan>) => p.blocks.filter((b) => b.kind !== 'container').map((b) => `${b.id}@${b.start}`)

  it('adding a task does not move existing blocks', () => {
    const extra = task('New thing', 'outside', { estimateMin: 30 })
    const next = plan({ tasks: [...base, extra], events: [], prefs: D, weeks: {}, now, previous: first })
    const before = new Set(positions(first).filter((x) => !x.includes(':outside:')))
    for (const pos of before) expect(positions(next)).toContain(pos)
    expect(next.mode).toBe('incremental')
  })

  it('completing a task frees its block without reshuffling the rest', () => {
    const done = base.map((t) => (t.title === 'Mail C' ? { ...t, done: true } : t))
    const next = plan({ tasks: done, events: [], prefs: D, weeks: {}, now, previous: first })
    const thesisBefore = first.blocks.find((b) => b.chunks.some((c) => c.taskId === base[0].id))!
    expect(next.blocks.find((b) => b.id === thesisBefore.id)?.start).toBe(thesisBefore.start)
    expect(next.blocks.some((b) => b.chunks.some((c) => c.taskId === base[2].id))).toBe(false)
  })

  it('a new calendar event only displaces the block it collides with', () => {
    const thesisBlock = first.blocks.find((b) => b.chunks.some((c) => c.taskId === base[0].id))!
    const meeting = ev('Meeting', 'Personal', thesisBlock.start, thesisBlock.end)
    const next = plan({ tasks: base, events: [meeting], prefs: D, weeks: {}, now, previous: first })
    const moved = next.blocks.find((b) => b.chunks.some((c) => c.taskId === base[0].id))!
    expect(new Date(moved.start) >= new Date(meeting.end) || new Date(moved.end) <= new Date(meeting.start)).toBe(true)
    expect(next.warnings.some((w) => w.kind === 'conflict')).toBe(true)
    const others = first.blocks.filter((b) => b.id !== thesisBlock.id && b.kind === 'proposed')
    for (const o of others) expect(next.blocks.find((b) => b.id === o.id)?.start).toBe(o.start)
  })

  it('blocks already started stay as they were', () => {
    const later = new Date(2026, 10, 9, 12, 0)
    const started = first.blocks.find((b) => b.start.startsWith('2026-11-09') && (b.kind === 'proposed' || b.kind === 'topup') && new Date(b.start) < later)!
    const next = plan({ tasks: base, events: [], prefs: D, weeks: {}, now: later, previous: first })
    expect(next.blocks.find((b) => b.id === started.id)?.start).toBe(started.start)
  })
})

describe('chunks', () => {
  it('lists a task once per block even when it is filled in two steps', () => {
    const p = plan({ tasks: [task('Long thesis', 'thesis', { estimateMin: 240 })], events: [ev('Thesis Deep Work', 'Study Schedule', '2026-11-09T13:30:00', '2026-11-09T14:00:00')], prefs: DEFAULT_PREFERENCES, weeks: {}, now })
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
    const p = plan({ tasks: [o, t], events: [], prefs: { ...D, allocation: { ...D.allocation, enabled: false } }, weeks: {}, now })
    expect(p.taskFinish[t.id] <= p.taskFinish[o.id]).toBe(true)
  })

  it('keeps each area within its grid hours for the day', () => {
    const courses = Array.from({ length: 6 }, (_, i) => task(`C${i}`, 'courses', { estimateMin: 60 }))
    const p = plan({ tasks: courses, events: [], prefs: D, weeks: {}, now })
    expect(minutes(p, 'courses', '2026-11-09')).toBeLessThanOrEqual(120) // Mon: 2h
    expect(minutes(p, 'courses', '2026-11-10')).toBeLessThanOrEqual(180) // Tue: 3h
    expect(minutes(p, 'courses', '2026-11-15')).toBe(0) // Sun: none
  })

  it('lets leftover tasks use a day where their area has 0 grid hours', () => {
    const courses = Array.from({ length: 30 }, (_, i) => task(`Course ${i}`, 'courses', { estimateMin: 60 }))
    const p = plan({ tasks: courses, events: [], prefs: D, weeks: {}, now })
    expect(minutes(p, 'courses', '2026-11-09')).toBeLessThanOrEqual(120) // days with hours still keep their limit
    expect(minutes(p, 'courses', '2026-11-15')).toBeGreaterThan(0) // Sunday: 0 hours, but nothing else needs it
  })

  it('areas with hours that day come first; the 0-hour area only gets what is left', () => {
    const mine = [
      ...Array.from({ length: 10 }, (_, i) => task(`Thesis ${i}`, 'thesis', { estimateMin: 60 })),
      ...Array.from({ length: 10 }, (_, i) => task(`Outside ${i}`, 'outside', { estimateMin: 60 })),
      ...Array.from({ length: 10 }, (_, i) => task(`Personal ${i}`, 'personal', { estimateMin: 60 }))
    ]
    const courses = Array.from({ length: 30 }, (_, i) => task(`Course ${i}`, 'courses', { estimateMin: 60, priority: 'high' }))
    const p = plan({ tasks: [...courses, ...mine], events: [], prefs: D, weeks: {}, now })
    // Saturday: thesis 2h + outside 1h + personal 1h fill the 4h weekend cap, so high-priority courses still get none.
    expect(minutes(p, 'courses', '2026-11-14')).toBe(0)
    expect(minutes(p, 'thesis', '2026-11-14') + minutes(p, 'outside', '2026-11-14') + minutes(p, 'personal', '2026-11-14')).toBe(240)
  })

  it('ranks leftovers by priority, tasks without a grid row (Other) included', () => {
    const tight = { ...D, dailyMaxMinutes: { weekday: 60, weekend: 60 }, allocation: { enabled: true, hours: {} } }
    const low = task('Course, low', 'courses', { estimateMin: 60, priority: 'low' })
    const high = task('Other, high', 'other', { estimateMin: 60, priority: 'high' })
    const p = plan({ tasks: [low, high], events: [], prefs: tight, weeks: {}, now })
    const day = (id: string) => p.blocks.find((b) => b.chunks.some((c) => c.taskId === id))!.start.slice(0, 10)
    expect(day(high.id)).toBe('2026-11-09')
    expect(day(low.id)).toBe('2026-11-10')
  })

  it('reserves thesis grid hours even without tasks', () => {
    const p = plan({ tasks: [], events: [], prefs: D, weeks: {}, now })
    expect(minutes(p, 'thesis', '2026-11-09')).toBe(240)
    expect(minutes(p, 'thesis', '2026-11-10')).toBe(120)
  })

  it('reserved hours get their grid time before small tasks from other areas fragment the day', () => {
    const smalls = [...Array.from({ length: 12 }, (_, i) => task(`Errand ${i}`, 'personal', { estimateMin: 30 })), ...Array.from({ length: 12 }, (_, i) => task(`Mail ${i}`, 'outside', { estimateMin: 30 }))]
    const p = plan({ tasks: [task('One thesis task', 'thesis', { estimateMin: 90 }), ...smalls], events: [], prefs: D, weeks: {}, now })
    for (const day of ['2026-11-09', '2026-11-11', '2026-11-13']) expect(minutes(p, 'thesis', day)).toBe(240)
  })

  it('lets a guarded deadline exceed the grid', () => {
    const urgent = task('Urgent course hand-in', 'courses', { estimateMin: 180, due: '2026-11-09' })
    const p = plan({ tasks: [urgent], events: [], prefs: D, weeks: {}, now })
    expect(minutes(p, 'courses', '2026-11-09')).toBeGreaterThan(120)
  })

  it('spreads an @spread task evenly until its deadline instead of front-loading', () => {
    const noGrid = { ...D, allocation: { ...D.allocation, enabled: false } }
    const big = task('Write chapter', 'thesis', { estimateMin: 480, due: '2026-11-14', timing: 'spread' })
    const p = plan({ tasks: [big], events: [], prefs: noGrid, weeks: {}, now })
    const per = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((d) =>
      p.blocks.filter((b) => b.start.startsWith(d)).flatMap((b) => b.chunks).filter((c) => c.taskId === big.id).reduce((s, c) => s + c.minutes, 0)
    )
    expect(per.every((m) => m > 0 && m <= 120)).toBe(true)
    const asap = plan({ tasks: [{ ...big, timing: 'asap' }], events: [], prefs: noGrid, weeks: {}, now })
    const monday = asap.blocks.filter((b) => b.start.startsWith('2026-11-09')).flatMap((b) => b.chunks).reduce((s, c) => s + c.minutes, 0)
    expect(monday).toBeGreaterThan(per[0])
  })
})

describe('calendar edits win', () => {
  it('does not recreate a block the user deleted', () => {
    const t = task('Thesis A', 'thesis', { estimateMin: 120 })
    const first = plan({ tasks: [t], events: [], prefs, weeks: {}, now })
    const gone = first.blocks.find((b) => b.chunks.some((c) => c.taskId === t.id))!
    const next = plan({ tasks: [t], events: [], prefs, weeks: {}, now, previous: first, excludeIds: [gone.id] })
    expect(next.blocks.some((b) => b.id === gone.id)).toBe(false)
    expect(next.blocks.some((b) => b.chunks.some((c) => c.taskId === t.id))).toBe(true)
  })

  it('drops a moved (pinned) block deleted in the calendar but keeps planning its tasks', () => {
    const t = task('Thesis M', 'thesis', { estimateMin: 120 })
    const pin = { blockId: '2026-11-09:thesis:1', category: 'thesis', title: 'Thesis Deep Work', start: '2026-11-09T12:00:00', end: '2026-11-09T14:00:00', taskIds: [t.id] }
    const weeks = { '2026-W46': { week: '2026-W46', log: [], pins: [pin], overrides: {} } }
    const p = plan({ tasks: [t], events: [], prefs, weeks, now, excludeIds: [pin.blockId] })
    expect(p.blocks.some((b) => b.id === pin.blockId)).toBe(false)
    expect(minsIn(p.blocks, t.id)).toBe(120)
  })
})

describe('held time after a removal', () => {
  const week = (overrides: WeekData['overrides'], pins: WeekData['pins'] = []): Record<string, WeekData> => ({ '2026-W46': { week: '2026-W46', log: [], pins, overrides } })
  const inHold = (b: { start: string; end: string }) => new Date(b.start) < new Date('2026-11-09T12:00:00') && new Date(b.end) > new Date('2026-11-09T08:00:00')

  it('places nothing new in held time, but the tasks are still planned', () => {
    const t = task('Thesis H', 'thesis', { estimateMin: 120 })
    const p = plan({ tasks: [t], events: [], prefs, now, weeks: week({ holds: [{ start: '2026-11-09T08:00:00', end: '2026-11-09T12:00:00' }] }) })
    expect(p.blocks.filter((b) => b.kind !== 'pinned').some(inHold)).toBe(false)
    expect(minsIn(p.blocks, t.id)).toBe(120)
  })

  it('still lets the user drop something into it', () => {
    const t = task('Thesis I', 'thesis', { estimateMin: 60 })
    const pin = { blockId: 'pin:x', category: 'thesis', title: 'Thesis Deep Work', start: '2026-11-09T09:00:00', end: '2026-11-09T10:00:00', taskIds: [t.id] }
    const p = plan({ tasks: [t], events: [], prefs, now, weeks: week({ holds: [{ start: '2026-11-09T08:00:00', end: '2026-11-09T12:00:00' }] }, [pin]) })
    expect(p.blocks.find((b) => b.id === 'pin:x')?.chunks).toEqual([{ taskId: t.id, minutes: 60 }])
  })
})

describe('re-plan options', () => {
  const many = Array.from({ length: 12 }, (_, i) => task(`Outside ${i}`, 'outside', { estimateMin: 30 }))
  const order = (p: ReturnType<typeof plan>) => p.blocks.flatMap((b) => b.chunks.map((c) => c.taskId)).join()

  it('shuffle is deterministic per seed and differs from the default order', () => {
    const base = plan({ tasks: many, events: [], prefs, weeks: {}, now })
    const a = plan({ tasks: many, events: [], prefs, weeks: {}, now, seed: 7 })
    const b = plan({ tasks: many, events: [], prefs, weeks: {}, now, seed: 7 })
    expect(order(a)).toBe(order(b))
    expect(order(a)).not.toBe(order(base))
  })

  it('light week plans less work than balanced', () => {
    const big = Array.from({ length: 30 }, (_, i) => task(`Thesis ${i}`, 'thesis', { estimateMin: 120 }))
    const full = { ...DEFAULT_PREFERENCES }
    const metrics = (p: Preferences) => planMetrics(plan({ tasks: big, events: [], prefs: p, weeks: {}, now }), p, [], now)
    expect(metrics(applyVariant(full, 'light')).workHours).toBeLessThan(metrics(full).workHours)
  })

  it('deadlines first weighs deadlines more and plans everything as soon as possible', () => {
    const p = applyVariant({ ...prefs, categories: prefs.categories.map((c) => ({ ...c, timing: 'spread' as const })) }, 'deadlines')
    expect(p.strategy.deadlineWeight).toBe(prefs.strategy.deadlineWeight * 3)
    expect(p.categories.every((c) => c.timing === 'asap')).toBe(true)
  })
})

describe('preferred windows', () => {
  it('tries each preferred window in order before the hard window', () => {
    const t = task('Course W', 'courses', { estimateMin: 60 })
    const cats = prefs.categories.map((c) => (c.key === 'courses' ? { ...c, preferredWindows: [['18:00', '19:00'], ['10:00', '12:00']] as [string, string][] } : c))
    const p = plan({ tasks: [t], events: [ev('Busy', 'Other', '2026-11-09T18:00:00', '2026-11-09T19:00:00')], prefs: { ...prefs, categories: cats }, weeks: {}, now })
    const b = p.blocks.find((x) => x.chunks.some((c) => c.taskId === t.id))!
    expect(b.start).toBe('2026-11-09T10:00:00')
  })
})

describe('busy / free events', () => {
  // A long Monday event: busy → no work may overlap it; free → the planner schedules over it.
  const long = (extra: Partial<CalEvent> = {}) => ev('Hackathon', 'ETH Classes HS26', '2026-11-09T07:00:00', '2026-11-09T20:00:00', extra)
  const overlapsEvent = (p: ReturnType<typeof plan>, e: CalEvent) =>
    p.blocks.some((b) => b.kind !== 'break' && new Date(b.start).getTime() < new Date(e.end).getTime() && new Date(b.end).getTime() > new Date(e.start).getTime())
  const run = (e: CalEvent, extra: Partial<Parameters<typeof plan>[0]> = {}) =>
    plan({ tasks: [task('Big', 'thesis', { estimateMin: 600 })], events: [e], prefs, weeks: {}, now, ...extra })

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
    const base = { tasks: [first, mine], events: [container()], prefs, now }
    const without = plan({ ...base, weeks: {} }).blocks.find((b) => b.id === cid)!
    expect(without.chunks[0]).toEqual({ taskId: first.id, minutes: 120 })
    const p = plan({ ...base, weeks: week({ assignments: [{ blockId: cid, taskIds: [mine.id] }] }) })
    const c = p.blocks.find((b) => b.id === cid)!
    expect(c.chunks[0]).toEqual({ taskId: mine.id, minutes: 120 })
    expect(minsIn(p.blocks, first.id)).toBe(120)
  })

  it('keeps an excluded task out of a block', () => {
    const t = task('Not here', 'thesis', { estimateMin: 120 })
    const p = plan({ tasks: [t], events: [container()], prefs, now, weeks: week({ exclusions: [{ blockId: cid, taskId: t.id }] }) })
    expect(p.blocks.find((b) => b.id === cid)!.chunks).toHaveLength(0)
    expect(minsIn(p.blocks, t.id)).toBe(120)
  })

  it('does not recreate a dismissed proposed block under its id', () => {
    const t = task('Thesis B', 'thesis', { estimateMin: 120 })
    const first = plan({ tasks: [t], events: [], prefs, weeks: {}, now })
    const gone = first.blocks.find((b) => b.kind === 'proposed' && b.chunks.some((c) => c.taskId === t.id))!
    for (const anchorFuture of [true, false]) {
      const next = plan({ tasks: [t], events: [], prefs, now, previous: first, anchorFuture, weeks: week({ dismissed: [gone.id] }) })
      expect(next.blocks.some((b) => b.id === gone.id)).toBe(false)
      expect(minsIn(next.blocks, t.id)).toBe(120)
    }
  })

  it('does not fill a dismissed container (it stays busy)', () => {
    const t = task('Thesis C', 'thesis', { estimateMin: 120 })
    const p = plan({ tasks: [t], events: [container()], prefs, now, weeks: week({ dismissed: [cid] }) })
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
    const p = plan({ tasks: [], events: [], prefs, now, weeks: week({ dismissed: [id] }) })
    expect(p.blocks.some((b) => b.id === id)).toBe(false)
    expect(p.blocks.some((b) => b.id === `break:2026-11-10:${br.label}`)).toBe(true)
  })
})
