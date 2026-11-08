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
const prefs: Preferences = { ...DEFAULT_PREFERENCES, categories: DEFAULT_PREFERENCES.categories.map((c) => ({ ...c, budget: undefined })) }

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

  it('orders by deadline, then priority', () => {
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
    expect(p.taskFinish[late.id] <= p.taskFinish[high.id]).toBe(true)
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
