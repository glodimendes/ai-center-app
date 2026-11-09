import { describe, expect, it } from 'vitest'
import type { Block, CalEvent, CalendarInfo } from '@shared/types'
import { buildSyncDiff } from '../electron/main/calendar/sync'
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
