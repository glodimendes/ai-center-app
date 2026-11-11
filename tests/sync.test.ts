import { describe, expect, it } from 'vitest'
import type { Block, CalEvent, CalendarInfo } from '@shared/types'
import { buildSyncDiff } from '../electron/main/calendar/sync'
import { calendarEdits } from '../electron/main/calendar/adopt'
import { DEFAULT_PREFERENCES } from '../electron/main/vault/preferences'

const now = new Date(2026, 10, 9, 7, 0)
const calendars: CalendarInfo[] = [
  { id: 'study', name: 'Study Schedule', color: '#00f', writable: true },
  { id: 'sports', name: 'Sports', color: '#f00', writable: true },
  { id: 'eth', name: 'ETH Classes HS26', color: '#888', writable: false }
]
const block = (id: string, start: string, end: string, extra: Partial<Block> = {}): Block => ({
  id,
  kind: 'proposed',
  category: 'thesis',
  title: 'Thesis Deep Work',
  start,
  end,
  calendarName: 'Study Schedule',
  chunks: [],
  ...extra
})
const tagged = (blockId: string, start: string, end: string, extra: Partial<CalEvent> = {}): CalEvent => ({
  id: 'e-' + blockId,
  calendarId: 'study',
  calendarName: 'Study Schedule',
  title: 'Thesis Deep Work',
  start,
  end,
  allDay: false,
  description: 'Planned by AI Center',
  plannerBlockId: blockId,
  ...extra
})
const diff = (blocks: Block[], events: CalEvent[]) => buildSyncDiff(blocks, events, calendars, DEFAULT_PREFERENCES, [], now)

describe('buildSyncDiff', () => {
  it('creates new blocks in the category calendar', () => {
    const { ops } = diff([block('a', '2026-11-09T09:00:00', '2026-11-09T11:00:00')], [])
    expect(ops).toMatchObject([{ op: 'create', calendarId: 'study', blockId: 'a' }])
  })

  it('moves an existing planner event instead of recreating it', () => {
    const { ops } = diff([block('a', '2026-11-09T10:00:00', '2026-11-09T12:00:00')], [tagged('a', '2026-11-09T09:00:00+01:00', '2026-11-09T11:00:00+01:00')])
    expect(ops).toMatchObject([{ op: 'update', eventId: 'e-a' }])
  })

  it('does nothing when already in sync (offset vs local times)', () => {
    const { ops } = diff([block('a', '2026-11-09T09:00:00', '2026-11-09T11:00:00')], [tagged('a', '2026-11-09T09:00:00+01:00', '2026-11-09T11:00:00+01:00')])
    expect(ops).toEqual([])
  })

  it('removes stale future planner events but leaves past ones and untagged events alone', () => {
    const events = [
      tagged('old-future', '2026-11-10T09:00:00+01:00', '2026-11-10T10:00:00+01:00'),
      tagged('old-past', '2026-11-09T05:00:00+01:00', '2026-11-09T06:00:00+01:00'),
      { ...tagged('x', '2026-11-10T12:00:00+01:00', '2026-11-10T13:00:00+01:00'), plannerBlockId: undefined, id: 'mine' }
    ]
    const { ops } = diff([], events)
    expect(ops.map((o) => [o.op, o.eventId])).toEqual([['delete', 'e-old-future']])
  })

  it('never syncs container blocks (they are your own events)', () => {
    const { ops } = diff([block('evt:1', '2026-11-09T09:00:00', '2026-11-09T11:00:00', { kind: 'container', eventId: '1' })], [])
    expect(ops).toEqual([])
  })

  it('moves an event between calendars by delete + create', () => {
    const { ops } = diff(
      [block('t', '2026-11-09T18:00:00', '2026-11-09T19:00:00', { kind: 'proposed', category: 'training', calendarName: 'Sports', title: 'Back A + Triceps' })],
      [tagged('t', '2026-11-09T18:00:00+01:00', '2026-11-09T19:00:00+01:00', { title: 'Back A + Triceps' })]
    )
    expect(ops.map((o) => [o.op, o.calendarId])).toEqual([
      ['delete', 'study'],
      ['create', 'sports']
    ])
  })

  it('reports unknown or read-only calendars instead of writing', () => {
    const r = diff([block('a', '2026-11-09T09:00:00', '2026-11-09T10:00:00', { calendarName: 'ETH Classes HS26' })], [])
    expect(r.ops).toEqual([])
    expect(r.problems[0]).toMatch(/protected|read-only/)
  })

  it('never writes to protected calendars', () => {
    const cals = [...calendars, { id: 'fam', name: 'Family', color: '#0f0', writable: true }]
    const r = buildSyncDiff([block('a', '2026-11-09T09:00:00', '2026-11-09T10:00:00', { calendarName: 'Family' })], [], cals, DEFAULT_PREFERENCES, [], now)
    expect(r.ops).toEqual([])
    expect(r.problems[0]).toMatch(/protected/)
  })

  it('ignores blocks beyond the sync window', () => {
    const { ops } = diff([block('far', '2026-11-20T09:00:00', '2026-11-20T10:00:00')], [])
    expect(ops).toEqual([])
  })
})

describe('buildSyncDiff for a single day', () => {
  const dayDiff = (day: string, blocks: Block[], events: CalEvent[] = []) =>
    buildSyncDiff(blocks, events, calendars, DEFAULT_PREFERENCES, [], now, day)

  it('syncs only the blocks of that day', () => {
    const { ops } = dayDiff('2026-11-10', [
      block('today', '2026-11-09T09:00:00', '2026-11-09T10:00:00'),
      block('target', '2026-11-10T09:00:00', '2026-11-10T10:00:00'),
      block('after', '2026-11-11T09:00:00', '2026-11-11T10:00:00')
    ])
    expect(ops).toMatchObject([{ op: 'create', blockId: 'target' }])
  })

  // A bare YYYY-MM-DD parsed as UTC shifts the window by the local offset, which drops or
  // steals the blocks either side of midnight; these three pin the window to the local day.
  it('covers the whole local day, midnight included', () => {
    const { ops } = dayDiff('2026-11-10', [block('early', '2026-11-10T00:30:00', '2026-11-10T01:30:00')])
    expect(ops).toMatchObject([{ op: 'create', blockId: 'early' }])
  })

  it('leaves the late evening before it alone', () => {
    const { ops } = dayDiff('2026-11-10', [block('prev', '2026-11-09T23:00:00', '2026-11-09T23:30:00')])
    expect(ops).toEqual([])
  })

  it('leaves the small hours after it alone', () => {
    const { ops } = dayDiff('2026-11-10', [block('next', '2026-11-11T00:30:00', '2026-11-11T01:00:00')])
    expect(ops).toEqual([])
  })

  it('removes a leftover planner event on that day', () => {
    const { ops } = dayDiff('2026-11-10', [], [tagged('gone', '2026-11-10T14:00:00', '2026-11-10T15:00:00')])
    expect(ops).toMatchObject([{ op: 'delete', blockId: 'gone' }])
  })

  it('keeps leftover planner events on other days', () => {
    const { ops } = dayDiff('2026-11-10', [], [tagged('other', '2026-11-11T14:00:00', '2026-11-11T15:00:00')])
    expect(ops).toEqual([])
  })

  it('still ignores untagged events', () => {
    const own = { ...tagged('x', '2026-11-10T09:00:00', '2026-11-10T10:00:00'), plannerBlockId: undefined, title: 'Dentist' }
    const { ops } = dayDiff('2026-11-10', [], [own])
    expect(ops).toEqual([])
  })
})

describe('calendarEdits (your calendar edits win)', () => {
  const from = new Date(2026, 10, 9)
  const at = new Date(2026, 10, 10, 12, 0)
  const synced = {
    'b-moved': { eventId: 'e1', calendarId: 'study', start: '2026-11-11T09:00:00', end: '2026-11-11T10:00:00' },
    'b-same': { eventId: 'e2', calendarId: 'study', start: '2026-11-11T14:00:00', end: '2026-11-11T15:00:00' },
    'b-deleted': { eventId: 'e3', calendarId: 'study', start: '2026-11-12T09:00:00', end: '2026-11-12T10:00:00' },
    'b-past-gone': { eventId: 'e4', calendarId: 'study', start: '2026-11-09T09:00:00', end: '2026-11-09T10:00:00' },
    'b-offline': { eventId: 'e5', calendarId: 'sports', start: '2026-11-12T18:00:00', end: '2026-11-12T19:00:00' },
    'b-old': { eventId: 'e6', calendarId: 'study', start: '2026-11-02T09:00:00', end: '2026-11-02T10:00:00' }
  }
  const ev = (id: string, blockId: string, start: string, end: string) => ({ id, calendarId: 'study', calendarName: 'Study Schedule', title: 'Thesis', start, end, allDay: false, plannerBlockId: blockId })
  const events = [ev('e1', 'b-moved', '2026-11-11T10:00:00+01:00', '2026-11-11T11:30:00+01:00'), ev('e2', 'b-same', '2026-11-11T14:00:00+01:00', '2026-11-11T15:00:00+01:00')]
  const out = calendarEdits(synced, events, from, ['study'], at)

  it('pins a block moved or resized in the calendar, compared as instants', () => {
    expect(out.moved.map((m) => m.blockId)).toEqual(['b-moved'])
  })

  it('dismisses a block deleted while still ahead, and only forgets a past one', () => {
    expect(out.deleted.map((d) => d.blockId)).toEqual(['b-deleted'])
    expect(out.forget.sort()).toEqual(['b-deleted', 'b-past-gone'])
  })

  it('leaves blocks alone when their calendar did not load (offline account)', () => {
    expect([...out.deleted, ...out.moved].some((x) => x.blockId === 'b-offline')).toBe(false)
    expect(out.forget).not.toContain('b-offline')
  })

  it('ignores blocks before the loaded window', () => {
    expect(out.forget).not.toContain('b-old')
  })
})
