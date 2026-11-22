import { mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Metrics } from '../electron/main/metrics'

const rows = (dir: string) => readdirSync(dir).flatMap((f) => readFileSync(join(dir, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)))

describe('usage log', () => {
  it('does nothing before init', () => {
    const m = new Metrics()
    expect(() => m.event('x', { a: 1 })).not.toThrow()
    m.flush()
  })
  it('writes names, numbers and flags, and drops long text and empty values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'metrics-'))
    const m = new Metrics()
    m.init(dir)
    m.event('ai', { purpose: 'brief', ms: 1234.56789, ok: true, secret: 'Dear Anna, this is the text of a very private email '.repeat(3), none: undefined, nul: null })
    m.close()
    const [r] = rows(dir)
    expect(r).toMatchObject({ ev: 'ai', purpose: 'brief', ms: 1234.568, ok: true })
    expect(r.secret).toBeUndefined()
    expect(r.none).toBeUndefined()
    expect(JSON.stringify(r)).not.toContain('private email')
  })
  it('times a call, also when it throws', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'metrics-'))
    const m = new Metrics()
    m.init(dir)
    expect(await m.time('ipc', async () => 7, { method: 'a' })).toBe(7)
    await expect(m.time('ipc', () => Promise.reject(new Error('x')), { method: 'b' })).rejects.toThrow('x')
    m.close()
    const r = rows(dir)
    expect(r.map((x) => [x.method, x.ok])).toEqual([['a', true], ['b', false]])
    expect(typeof r[0].ms).toBe('number')
  })
  it('removes files older than 90 days at start', () => {
    const dir = mkdtempSync(join(tmpdir(), 'metrics-'))
    const old = join(dir, '2020-01-01.jsonl')
    writeFileSync(old, '{}\n')
    utimesSync(old, new Date('2020-01-01'), new Date('2020-01-01'))
    new Metrics().init(dir)
    expect(readdirSync(dir)).toEqual([])
  })
})
