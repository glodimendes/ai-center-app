import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { claudeCli } from '../electron/main/agents/engines/claude-cli'
import { codexCli, codexLimits } from '../electron/main/agents/engines/codex-cli'
import { budgetPause, currentWindows, dailyTotals, readCodexLimits, readRunRows, usageTotals } from '../electron/main/agents/usage'
import { Supervisor } from '../electron/main/agents/supervisor'
import { parseAgent } from '../electron/main/agents/definition'

const future = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()
const past = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

describe('limit reports from the CLIs', () => {
  it('Claude: utilization is a fraction, windows come from unifiedWindows', () => {
    const ev = claudeCli.parse({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.17, resetsAt: 1795311600 }, seven_day: { utilization: 0.32, resetsAt: 1795622400 } } } })
    expect(ev).toEqual([{ type: 'limits', limits: { fiveHour: { usedPct: 17, resetsAt: new Date(1795311600 * 1000).toISOString() }, weekly: { usedPct: 32, resetsAt: new Date(1795622400 * 1000).toISOString() } } }])
    expect(claudeCli.parse({ type: 'rate_limit_event', rate_limit_info: {} })).toEqual([{ type: 'limits', limits: { fiveHour: undefined, weekly: undefined } }])
  })
  it('Codex: primary is 5 h, secondary is weekly, percent as reported', () => {
    expect(codexLimits({ primary: { used_percent: 1, window_minutes: 300, resets_at: 1793753865 }, secondary: { used_percent: 20, window_minutes: 10080, resets_at: 1794158000 } })).toEqual({
      fiveHour: { usedPct: 1, resetsAt: new Date(1793753865 * 1000).toISOString() },
      weekly: { usedPct: 20, resetsAt: new Date(1794158000 * 1000).toISOString() }
    })
    expect(codexLimits(null)).toEqual({})
    const ev = codexCli.parse({ msg: { type: 'token_count', rate_limits: { primary: { used_percent: 5, window_minutes: 300, resets_at: 1793753865 } } } })
    expect(ev[0]).toMatchObject({ type: 'limits', limits: { fiveHour: { usedPct: 5 } } })
  })
  it('reads the newest Codex session log, read-only', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-home-'))
    const dir = join(home, 'sessions/2026/11/21')
    mkdirSync(dir, { recursive: true })
    const line = (pct: number) => JSON.stringify({ timestamp: '2026-11-21T10:00:00Z', payload: { type: 'token_count', rate_limits: { primary: { used_percent: pct, window_minutes: 300, resets_at: 1793753865 } } } })
    writeFileSync(join(dir, 'a.jsonl'), `${line(10)}\nnoise\n${line(42)}\n{"x":1}\n`)
    expect(readCodexLimits(home)?.fiveHour?.usedPct).toBe(42)
    expect(readCodexLimits(join(home, 'missing'))).toBeNull()
    rmSync(home, { recursive: true })
  })
})

describe('budget', () => {
  const l = { fiveHour: { usedPct: 80, resetsAt: future(2) }, weekly: { usedPct: 30, resetsAt: future(100) }, asOf: '' }
  it('pauses at or above the ceiling in either window, names which', () => {
    expect(budgetPause(l, 70, 'Claude')).toMatch(/5-hour window is 80%/)
    expect(budgetPause(l, 80, 'Claude')).toMatch(/5-hour/)
    expect(budgetPause(l, 90, 'Claude')).toBeNull()
    expect(budgetPause({ ...l, fiveHour: { usedPct: 10, resetsAt: future(1) }, weekly: { usedPct: 75, resetsAt: future(5) } }, 70, 'X')).toMatch(/weekly/)
  })
  it('a window that has reset is ignored, and unknown usage never blocks', () => {
    const stale = { ...l, fiveHour: { usedPct: 99, resetsAt: past(1) } }
    expect(currentWindows(stale).fiveHour).toBeUndefined()
    expect(budgetPause(stale, 70, 'X')).toBeNull()
    expect(budgetPause(null, 70, 'X')).toBeNull()
    expect(budgetPause(undefined, 1, 'X')).toBeNull()
  })
})

describe('supervisor pause', () => {
  const def = parseAgent('a', '---\nname: A\n---\nDo it.')
  const never = async () => ({ text: 'ok' })
  it('holds a run when the gate says so; Allow starts it, Skip cancels it', async () => {
    const exec = vi.fn(never)
    const sup = new Supervisor(exec, null, undefined, () => 'over budget')
    const r1 = sup.enqueue(def, 'one')
    await vi.waitFor(() => expect(r1.status).toBe('paused'))
    expect(r1.pauseReason).toBe('over budget')
    expect(exec).not.toHaveBeenCalled()
    sup.allow(r1.id)
    await vi.waitFor(() => expect(r1.status).toBe('done'))
    expect(exec).toHaveBeenCalledTimes(1)
    const r2 = sup.enqueue(def, 'two')
    await vi.waitFor(() => expect(r2.status).toBe('paused'))
    sup.cancel(r2.id)
    await vi.waitFor(() => expect(r2.status).toBe('cancelled'))
    expect(exec).toHaveBeenCalledTimes(1)
  })
  it('a run behind a paused one waits for it', async () => {
    const sup = new Supervisor(never, null, undefined, (run) => (run.input.text === 'one' ? 'wait' : null))
    const r1 = sup.enqueue(def, 'one')
    const r2 = sup.enqueue(def, 'two')
    await vi.waitFor(() => expect(r1.status).toBe('paused'))
    expect(r2.status).toBe('queued')
    sup.allow(r1.id)
    await vi.waitFor(() => expect(r2.status).toBe('done'))
  })
})

describe('run totals', () => {
  it('sums finished runs per agent and profile for today and the week', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runs-'))
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    mkdirSync(join(dir, month), { recursive: true })
    const end = (id: string, agent: string, t: Date, usage: object, status = 'done') => appendFileSync(join(dir, month, `${id}.jsonl`), JSON.stringify({ t: t.toISOString(), agent, type: 'end', status, profile: 'claude', usage }) + '\n')
    end('a', 'x', now, { inputTokens: 10, outputTokens: 5, costUsd: 0.01 })
    end('b', 'x', now, { inputTokens: 20, outputTokens: 5, costUsd: 0.02 })
    end('c', 'y', now, { inputTokens: 1, outputTokens: 1 }, 'error')
    const rows = readRunRows(dir, Date.now() - 7 * 86_400_000)
    expect(rows).toHaveLength(2)
    const t = usageTotals(rows, now)
    expect(t.today).toEqual([{ agentId: 'x', profile: 'claude', runs: 2, inputTokens: 30, outputTokens: 10, costUsd: 0.03 }])
    expect(t.week).toHaveLength(1)
    expect(readRunRows(join(dir, 'nope'), 0)).toEqual([])
    rmSync(dir, { recursive: true })
  })

  it('totals the last 30 days and gives one entry per day, with empty days kept', () => {
    const now = new Date(2026, 10, 22, 15, 0)
    const day = (back: number, h = 9) => new Date(2026, 10, 22 - back, h).getTime()
    const row = (t: number, cost: number) => ({ t, agentId: 'x', profile: 'claude', inputTokens: 10, outputTokens: 5, costUsd: cost })
    const rows = [row(day(0), 0.01), row(day(0, 10), 0.02), row(day(3), 0.05), row(day(20), 0.1), row(day(40), 1)]
    const t = usageTotals(rows.filter((r) => r.t >= day(30)), now)
    expect(t.today[0].runs).toBe(2)
    expect(t.week[0].runs).toBe(3)
    expect(t.month[0].runs).toBe(4)
    const days = dailyTotals(rows, 14, now)
    expect(days).toHaveLength(14)
    expect(days.at(-1)).toMatchObject({ day: '2026-11-22', runs: 2, tokens: 30 })
    expect(days.at(-1)!.costUsd).toBeCloseTo(0.03)
    expect(days[0].day).toBe('2026-11-09')
    expect(days.find((d) => d.day === '2026-11-20')).toMatchObject({ runs: 0, tokens: 0, costUsd: 0 })
    expect(days.reduce((n, d) => n + d.runs, 0)).toBe(3)
  })
})
