import { describe, expect, it } from 'vitest'
import type { Routine } from '../shared/agents'
import { describeRoutine, parseDays } from '../shared/routines'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoutineStore, checkRoutine, dueRoutines } from '../electron/main/agents/routines'
import { parseQuestions } from '../electron/main/agents/actions'
import { canAutoRun } from '../electron/main/agents/permissions'

const r = (o: Partial<Routine> = {}): Routine => ({ id: 'r1', agentId: 'a', title: 'News', prompt: 'Summarise the news', time: '07:00', days: 'daily', createdAt: '2026-11-01T12:00:00', ...o })
// 2026-11-23 is a Monday.
const at = (d: string) => new Date(`${d}:00`)

describe('routines', () => {
  it('reads day rules', () => {
    expect(parseDays('weekdays')).toEqual([1, 2, 3, 4, 5])
    expect(parseDays('Mon, thursday')).toEqual([1, 4])
    expect(parseDays('someday')).toBeNull()
    expect(describeRoutine({ time: '07:00', days: 'mon,thu' })).toBe('Mon, Thu at 07:00')
  })

  it('runs once per slot, after its time, on its days, never for a slot before it was created', () => {
    expect(dueRoutines([r()], at('2026-11-23T06:59'))).toEqual([])
    expect(dueRoutines([r()], at('2026-11-23T07:00'))).toHaveLength(1)
    expect(dueRoutines([r({ lastRun: '2026-11-23T07:01:00' })], at('2026-11-23T09:00'))).toEqual([])
    expect(dueRoutines([r({ days: 'weekends' })], at('2026-11-23T09:00'))).toEqual([])
    expect(dueRoutines([r({ paused: true })], at('2026-11-23T09:00'))).toEqual([])
    expect(dueRoutines([r({ createdAt: '2026-11-23T08:00:00' })], at('2026-11-23T09:00'))).toEqual([])
  })

  it('keeps every routine across a reload', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'routines-')), 'routines.json')
    const a = new RoutineStore(file)
    a.add(r({ id: 'one' }))
    a.add(r({ id: 'two' }))
    a.update('one', { paused: true })
    expect(new RoutineStore(file).list().map((x) => [x.id, Boolean(x.paused)])).toEqual([['one', true], ['two', false]])
  })

  it('checks a proposal and never runs one without a click', () => {
    expect(checkRoutine({ prompt: 'x', time: '7:30', days: 'weekdays' })).toMatchObject({ time: '07:30', days: 'weekdays', title: 'x' })
    expect(() => checkRoutine({ prompt: 'x', time: '25:00' })).toThrow()
    expect(() => checkRoutine({ prompt: '', time: '07:00' })).toThrow()
    expect(canAutoRun('schedule', 'act')).toBe(false)
  })
})

describe('parseQuestions', () => {
  it('takes the block out of the answer and keeps valid questions', () => {
    const text = 'Which one?\n\n```questions\n[{"question": "Days?", "header": "Days", "options": [{"label": "Weekdays", "description": "Mon-Fri"}, "Every day", {"x": 1}]}, {"question": "no options"}]\n```'
    const q = parseQuestions(text)
    expect(q.text).toBe('Which one?')
    expect(q.questions).toEqual([{ question: 'Days?', header: 'Days', options: [{ label: 'Weekdays', description: 'Mon-Fri' }, { label: 'Every day', description: undefined }], multiSelect: undefined }])
  })
})
