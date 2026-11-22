import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/** When the main process loaded this module, about when the app started. */
export const startedAt = Date.now()

/**
 * Local usage log for finding what is slow or expensive: one JSON line per event in `<dir>/YYYY-MM-DD.jsonl`.
 * It records names, sizes, counts and durations only, never text (prompts, tasks, notes, mail): a string longer than
 * MAX_TEXT is dropped, so a stray piece of content can't end up in the file. Nothing leaves the machine. No Electron imports.
 */
const MAX_TEXT = 80
const KEEP_DAYS = 90
const FLUSH_MS = 5000

type Value = string | number | boolean | undefined | null
export type Fields = Record<string, Value>

export class Metrics {
  private dir: string | null = null
  private buf: string[] = []
  private timer: ReturnType<typeof setInterval> | null = null

  /** Starts logging into `dir` and removes files older than KEEP_DAYS. Without it every call is a no-op (tests, tools). */
  init(dir: string) {
    this.dir = dir
    try {
      mkdirSync(dir, { recursive: true })
      const limit = Date.now() - KEEP_DAYS * 86_400_000
      for (const f of readdirSync(dir)) if (f.endsWith('.jsonl') && statSync(join(dir, f)).mtimeMs < limit) unlinkSync(join(dir, f))
    } catch {
      /* logging must never break the app */
    }
    this.timer ??= setInterval(() => this.flush(), FLUSH_MS)
    this.timer.unref?.()
  }

  event(ev: string, fields: Fields = {}) {
    if (!this.dir) return
    const row: Record<string, Value> = { t: new Date().toISOString(), ev }
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null) continue
      if (typeof v === 'string' && v.length > MAX_TEXT) continue
      row[k] = typeof v === 'number' ? Math.round(v * 1000) / 1000 : v
    }
    this.buf.push(JSON.stringify(row))
    if (this.buf.length >= 200) this.flush()
  }

  /** Runs `fn` and logs how long it took (also when it throws). */
  async time<T>(ev: string, fn: () => Promise<T> | T, fields: Fields = {}): Promise<T> {
    const t0 = performance.now()
    let ok = true
    try {
      return await fn()
    } catch (e) {
      ok = false
      throw e
    } finally {
      this.event(ev, { ...fields, ms: performance.now() - t0, ok })
    }
  }

  flush() {
    if (!this.dir || !this.buf.length) return
    const lines = this.buf.join('\n') + '\n'
    this.buf = []
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
      appendFileSync(join(this.dir, `${new Date().toISOString().slice(0, 10)}.jsonl`), lines)
    } catch {
      /* dropped rather than failing the app */
    }
  }

  close() {
    this.flush()
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

/** The app-wide log. Call `metrics.init(dir)` once at start; before that (and in tests) it does nothing. */
export const metrics = new Metrics()
