import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadHistory, runFromLog } from '../electron/main/agents/history'
import { Supervisor } from '../electron/main/agents/supervisor'

const ev = (o: Record<string, unknown>) => JSON.stringify({ t: '2026-11-22T10:00:00.000Z', agent: 'scout', ...o })
const queued = (extra: Record<string, unknown> = {}) => ev({ type: 'queued', input: { from: 'user', to: 'scout', text: 'hi' }, ...extra })

describe('run history from logs', () => {
  it('rebuilds a finished run with its answer, usage and progress', () => {
    const log = [queued({ agentName: 'Scout', profile: 'claude', chat: true, queuedAt: '2026-11-22T09:59:00.000Z' }), ev({ type: 'start', t: '2026-11-22T10:00:01.000Z' }), ev({ type: 'progress', line: 'Read a.md' }), ev({ type: 'end', t: '2026-11-22T10:00:05.000Z', status: 'done', output: { from: 'scout', to: 'user', text: 'answer' }, usage: { costUsd: 0.01 }, outputFile: 'x.md' })].join('\n')
    const r = runFromLog('abc-1', log)!
    expect(r).toMatchObject({ id: 'abc-1', agentName: 'Scout', profile: 'claude', chat: true, status: 'done', queuedAt: '2026-11-22T09:59:00.000Z', startedAt: '2026-11-22T10:00:01.000Z', endedAt: '2026-11-22T10:00:05.000Z', outputFile: 'x.md' })
    expect(r.progress).toEqual(['Read a.md'])
    expect(r.output?.text).toBe('answer')
  })
  it('shows a run with no end as interrupted, and keeps errors', () => {
    const cut = runFromLog('a-1', [queued(), ev({ type: 'start' })].join('\n'))!
    expect(cut).toMatchObject({ status: 'cancelled', error: 'Interrupted when the app closed.' })
    const bad = runFromLog('a-2', [queued(), ev({ type: 'end', status: 'error', error: 'boom' })].join('\n'))!
    expect(bad).toMatchObject({ status: 'error', error: 'boom' })
  })
  it('reads old logs without the newer fields and skips damaged lines and logs with no queued event', () => {
    const r = runFromLog('a-3', ['{not json', queued(), ev({ type: 'end', status: 'done' })].join('\n'))!
    expect(r).toMatchObject({ agentName: 'scout', profile: '', status: 'done' })
    expect(runFromLog('a-4', ev({ type: 'end', status: 'done' }))).toBeNull()
  })
  it('loads the newest runs first up to the limit, returned oldest first, and seeds the supervisor', () => {
    const dir = mkdtempSync(join(tmpdir(), 'history-'))
    for (const [month, ids] of [['2026-10', ['a']], ['2026-11', ['b', 'c', 'd']]] as const)
      for (const id of ids) {
        mkdirSync(join(dir, month), { recursive: true })
        writeFileSync(join(dir, month, `${id}.jsonl`), [queued({ queuedAt: `2026-${month.slice(5)}-0${'abcd'.indexOf(id) + 1}T00:00:00.000Z` }), ev({ type: 'end', status: 'done' })].join('\n'))
      }
    const runs = loadHistory(dir, 3)
    expect(runs.map((r) => r.id)).toEqual(['b', 'c', 'd'])
    expect(loadHistory(join(dir, 'missing'))).toEqual([])
    const sup = new Supervisor(async () => ({ text: '' }), null)
    sup.seed(runs)
    expect(sup.list().map((r) => r.id)).toEqual(['b', 'c', 'd'])
  })
})
