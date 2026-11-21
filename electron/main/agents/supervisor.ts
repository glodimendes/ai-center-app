import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AgentDef, AgentMessage, Run, RunStatus, Usage } from '@shared/agents'

export type { AgentMessage, Run, RunStatus }

export interface Outcome {
  text: string
  usage?: Usage
}

export type Execute = (run: Run, def: AgentDef, onProgress: (line: string) => void, signal: { cancel: (fn: () => void) => void }) => Promise<Outcome>

/**
 * Runs agents one at a time (concurrency 1: a second run waits in the queue). Each run is logged as JSON lines
 * under `<logDir>/YYYY-MM/<id>.jsonl`. No Electron imports; `execute` is injected.
 */
export class Supervisor {
  private runs: Run[] = []
  private queue: { run: Run; def: AgentDef }[] = []
  private current: { run: Run; cancel: () => void } | null = null
  private seq = 0

  constructor(
    private execute: Execute,
    private logDir: string | null,
    private onChange: () => void = () => {}
  ) {}

  enqueue(def: AgentDef, text: string, opts: { from?: string; parentRunId?: string } = {}): Run {
    const run: Run = {
      id: `${Date.now().toString(36)}-${++this.seq}`,
      agentId: def.id,
      agentName: def.name,
      parentRunId: opts.parentRunId,
      input: { from: opts.from ?? 'user', to: def.id, text },
      status: 'queued',
      queuedAt: new Date().toISOString(),
      progress: []
    }
    this.runs.push(run)
    this.queue.push({ run, def })
    this.log(run, { type: 'queued', input: run.input })
    this.onChange()
    void this.pump()
    return run
  }

  list(): Run[] {
    return this.runs
  }

  get(id: string): Run | undefined {
    return this.runs.find((r) => r.id === id)
  }

  /** Cancels a queued run at once, or asks the running one to stop. */
  cancel(id: string) {
    const q = this.queue.findIndex((x) => x.run.id === id)
    if (q >= 0) {
      const [{ run }] = this.queue.splice(q, 1)
      this.finish(run, 'cancelled', 'Cancelled.')
    } else if (this.current?.run.id === id) this.current.cancel()
  }

  cancelAll() {
    for (const { run } of [...this.queue]) this.cancel(run.id)
    this.current?.cancel()
  }

  isBusy() {
    return this.current !== null || this.queue.length > 0
  }

  private async pump() {
    if (this.current) return
    const next = this.queue.shift()
    if (!next) return
    const { run, def } = next
    let cancelled = false
    let stop: () => void = () => {}
    this.current = { run, cancel: () => ((cancelled = true), stop()) }
    run.status = 'running'
    run.startedAt = new Date().toISOString()
    this.onChange()
    try {
      const out = await this.execute(
        run,
        def,
        (line) => {
          run.progress.push(line)
          if (run.progress.length > 200) run.progress.shift()
          this.log(run, { type: 'progress', line })
          this.onChange()
        },
        { cancel: (fn) => (stop = fn) }
      )
      run.usage = out.usage
      run.output = { from: def.id, to: run.input.from, text: out.text }
      this.finish(run, 'done')
    } catch (e) {
      const msg = (e as Error).message
      this.finish(run, cancelled || msg === 'Cancelled.' ? 'cancelled' : 'error', cancelled ? 'Cancelled.' : msg)
    } finally {
      this.current = null
      void this.pump()
    }
  }

  private finish(run: Run, status: RunStatus, error?: string) {
    run.status = status
    run.error = status === 'done' ? undefined : error
    run.endedAt = new Date().toISOString()
    this.log(run, { type: 'end', status, error: run.error, output: run.output, usage: run.usage })
    if (this.runs.length > 100) this.runs = this.runs.filter((r) => r.status === 'queued' || r.status === 'running' || this.runs.indexOf(r) >= this.runs.length - 100)
    this.onChange()
  }

  private log(run: Run, ev: Record<string, unknown>) {
    if (!this.logDir) return
    try {
      const file = join(this.logDir, run.queuedAt.slice(0, 7), `${run.id}.jsonl`)
      mkdirSync(dirname(file), { recursive: true })
      appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), agent: run.agentId, ...ev }) + '\n')
    } catch {
      /* logging must never fail a run */
    }
  }
}
