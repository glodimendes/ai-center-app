import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AgentDef, AgentMessage, HandoffPacket, Run, RunStatus, Usage } from '@shared/agents'

export type { AgentMessage, Run, RunStatus }

export interface Outcome {
  text: string
  usage?: Usage
}

/** Called before a run starts. A string pauses the run with that reason until the user allows or skips it. */
export type Gate = (run: Run, def: AgentDef) => Promise<string | null> | string | null

export type Execute = (run: Run, def: AgentDef, onProgress: (line: string) => void, signal: { cancel: (fn: () => void) => void }) => Promise<Outcome>

/**
 * Runs agents one at a time (concurrency 1: a second run waits in the queue). Each run is logged as JSON lines
 * under `<logDir>/YYYY-MM/<id>.jsonl`. No Electron imports; `execute` is injected.
 */
export class Supervisor {
  private runs: Run[] = []
  private queue: { run: Run; def: AgentDef }[] = []
  private current: { run: Run; cancel: () => void; resume?: () => void } | null = null
  private seq = 0
  private waiters = new Map<string, ((r: Run) => void)[]>()

  constructor(
    private execute: Execute,
    private logDir: string | null,
    private onChange: () => void = () => {},
    private gate?: Gate,
    /** Where waiting conversation turns and handoffs are kept, so they survive a restart. */
    private queueFile: string | null = null
  ) {}

  enqueue(def: AgentDef, text: string, opts: { from?: string; parentRunId?: string; chat?: boolean; packet?: HandoffPacket; chainId?: string; hops?: number } = {}): Run {
    const run: Run = {
      id: `${Date.now().toString(36)}-${++this.seq}`,
      agentId: def.id,
      agentName: def.name,
      profile: def.profile,
      parentRunId: opts.parentRunId,
      chainId: opts.chainId,
      hops: opts.hops,
      chat: opts.chat || undefined,
      input: { from: opts.from ?? 'user', to: def.id, text, packet: opts.packet },
      status: 'queued',
      queuedAt: new Date().toISOString(),
      progress: []
    }
    run.chainId ??= run.id
    this.runs.push(run)
    this.queue.push({ run, def })
    this.log(run, { type: 'queued', input: run.input })
    this.saveQueue()
    this.onChange()
    void this.pump()
    return run
  }

  /** Only conversation turns and handoffs are worth keeping across a restart; a stale schedule or capture isn't. */
  private static keep = (r: Run) => Boolean(r.chat || r.input.packet || r.input.from === 'central')

  private closing = false

  private saveQueue() {
    if (!this.queueFile || this.closing) return
    try {
      const items = this.queue.filter((q) => Supervisor.keep(q.run)).map(({ run }) => ({ agentId: run.agentId, text: run.input.text, from: run.input.from, parentRunId: run.parentRunId, chainId: run.chainId, hops: run.hops, chat: run.chat, packet: run.input.packet }))
      writeFileSync(this.queueFile, JSON.stringify(items))
    } catch {
      /* the queue is best effort */
    }
  }

  /** Puts the waiting items of the last session back in the queue. Items whose agent is gone are dropped. */
  restore(find: (agentId: string) => AgentDef | undefined): number {
    if (!this.queueFile || !existsSync(this.queueFile)) return 0
    let n = 0
    try {
      const items = JSON.parse(readFileSync(this.queueFile, 'utf8')) as { agentId: string; text: string; from: string; parentRunId?: string; chainId?: string; hops?: number; chat?: boolean; packet?: HandoffPacket }[]
      writeFileSync(this.queueFile, '[]')
      for (const it of items) {
        const def = find(it.agentId)
        if (!def) continue
        this.enqueue(def, it.text, { from: it.from, parentRunId: it.parentRunId, chainId: it.chainId, hops: it.hops, chat: it.chat, packet: it.packet })
        n++
      }
    } catch {
      /* unreadable: start empty */
    }
    return n
  }

  /** Queued or running runs of one agent that are conversation turns (a cap on what can pile up behind it). */
  pendingFor(agentId: string, chatOnly = true): number {
    return this.runs.filter((r) => r.agentId === agentId && ['queued', 'running', 'paused'].includes(r.status) && (!chatOnly || r.chat)).length
  }

  list(): Run[] {
    return this.runs
  }

  get(id: string): Run | undefined {
    return this.runs.find((r) => r.id === id)
  }

  /** Resolves when the run has finished (done, error or cancelled). */
  wait(id: string): Promise<Run> {
    const run = this.get(id)
    if (!run) return Promise.reject(new Error('Unknown run.'))
    if (['done', 'error', 'cancelled'].includes(run.status)) return Promise.resolve(run)
    return new Promise((resolve) => this.waiters.set(id, [...(this.waiters.get(id) ?? []), resolve]))
  }

  /** Cancels a queued run at once, or asks the running one to stop. */
  cancel(id: string) {
    const q = this.queue.findIndex((x) => x.run.id === id)
    if (q >= 0) {
      const [{ run }] = this.queue.splice(q, 1)
      this.saveQueue()
      this.finish(run, 'cancelled', 'Cancelled.')
    } else if (this.current?.run.id === id) this.current.cancel()
  }

  /** App quit: stop everything but leave the saved queue as it is, so waiting items come back next time. */
  shutdown() {
    this.closing = true
    this.cancelAll()
  }

  cancelAll() {
    for (const { run } of [...this.queue]) this.cancel(run.id)
    this.current?.cancel()
  }

  /** Lets a paused run start (once). */
  allow(id: string) {
    if (this.current?.run.id === id) this.current.resume?.()
  }

  isBusy() {
    return this.current !== null || this.queue.length > 0
  }

  private async pump() {
    if (this.current) return
    const next = this.queue.shift()
    if (!next) return
    this.saveQueue()
    const { run, def } = next
    let cancelled = false
    let stop: () => void = () => {}
    this.current = { run, cancel: () => ((cancelled = true), stop()) }
    try {
      const reason = this.gate ? await this.gate(run, def) : null
      if (reason) {
        // Hold the queue until the user decides: allow once, or skip (cancel).
        run.status = 'paused'
        run.pauseReason = reason
        this.log(run, { type: 'paused', reason })
        this.onChange()
        await new Promise<void>((resolve, reject) => {
          this.current!.resume = resolve
          this.current!.cancel = () => ((cancelled = true), reject(new Error('Cancelled.')))
        })
        run.pauseReason = undefined
        this.current!.cancel = () => ((cancelled = true), stop())
      }
      run.status = 'running'
      run.startedAt = new Date().toISOString()
      this.onChange()
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
    this.log(run, { type: 'end', status, profile: run.profile, error: run.error, output: run.output, usage: run.usage })
    for (const w of this.waiters.get(run.id) ?? []) w(run)
    this.waiters.delete(run.id)
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
