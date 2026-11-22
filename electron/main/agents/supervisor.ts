import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AgentDef, AgentMessage, HandoffPacket, Run, RunStatus, Usage } from '@shared/agents'
import { metrics } from '../metrics'
import { needsReview } from './permissions'

export type { AgentMessage, Run, RunStatus }

export interface Outcome {
  text: string
  usage?: Usage
}

/** Called before a run starts. A string pauses the run with that reason until the user allows or skips it. */
export type Gate = (run: Run, def: AgentDef) => Promise<string | null> | string | null

export type Execute = (run: Run, def: AgentDef, onProgress: (line: string) => void, signal: { cancel: (fn: () => void) => void; text: (answerSoFar: string) => void }) => Promise<Outcome>

/** Runs kept in the list (older ones stay in the logs). */
export const HISTORY_CAP = 200

/** Runs that may be active at once. The CLIs' own rate limits are the real ceiling; this only keeps the machine calm. */
export const MAX_PARALLEL = 3

/**
 * Runs agents in parallel up to MAX_PARALLEL, with two rules: an agent never has two runs at once (a chat session takes one
 * turn at a time), and a run that needs review (propose/act) runs alone, because its vault snapshot would otherwise show
 * other runs' writes. Each run is logged as JSON lines under `<logDir>/YYYY-MM/<id>.jsonl`. No Electron imports; `execute` is injected.
 */
export class Supervisor {
  private runs: Run[] = []
  private queue: { run: Run; def: AgentDef }[] = []
  private active = new Map<string, { run: Run; exclusive: boolean; cancel: () => void; resume?: () => void }>()
  private seq = 0
  private waiters = new Map<string, ((r: Run) => void)[]>()

  constructor(
    private execute: Execute,
    private logDir: string | null,
    private onChange: () => void = () => {},
    private gate?: Gate,
    /** Where waiting conversation turns and handoffs are kept, so they survive a restart. */
    private queueFile: string | null = null,
    /** A run failed or paused: something worth telling the user about when the app is in the background. */
    private onEvent: (kind: 'failed' | 'paused', run: Run) => void = () => {}
  ) {}

  enqueue(def: AgentDef, text: string, opts: { from?: string; parentRunId?: string; chat?: boolean; packet?: HandoffPacket; chainId?: string; hops?: number; attachments?: string[] } = {}): Run {
    const run: Run = {
      id: `${Date.now().toString(36)}-${++this.seq}`,
      agentId: def.id,
      agentName: def.name,
      profile: def.profile,
      parentRunId: opts.parentRunId,
      chainId: opts.chainId,
      hops: opts.hops,
      chat: opts.chat || undefined,
      input: { from: opts.from ?? 'user', to: def.id, text, packet: opts.packet, attachments: opts.attachments?.length ? opts.attachments : undefined },
      status: 'queued',
      queuedAt: new Date().toISOString(),
      progress: []
    }
    run.chainId ??= run.id
    this.runs.push(run)
    this.queue.push({ run, def })
    this.log(run, { type: 'queued', agentName: def.name, profile: def.profile, chat: run.chat, queuedAt: run.queuedAt, input: run.input, permission: def.permission, model: def.model, chainId: run.chainId, hops: run.hops, parentRunId: run.parentRunId })
    this.saveQueue()
    this.onChange()
    this.pump()
    return run
  }

  /** Puts finished runs of earlier sessions (rebuilt from the logs) at the front of the history. */
  seed(past: Run[]) {
    const ids = new Set(this.runs.map((r) => r.id))
    this.runs = [...past.filter((r) => !ids.has(r.id)), ...this.runs]
  }

  /** Only conversation turns and handoffs are worth keeping across a restart; a stale schedule or capture isn't. */
  private static keep = (r: Run) => Boolean(r.chat || r.input.packet || r.input.from === 'central')

  private closing = false

  private saveQueue() {
    if (!this.queueFile || this.closing) return
    try {
      const items = this.queue.filter((q) => Supervisor.keep(q.run)).map(({ run }) => ({ agentId: run.agentId, text: run.input.text, from: run.input.from, parentRunId: run.parentRunId, chainId: run.chainId, hops: run.hops, chat: run.chat, packet: run.input.packet, attachments: run.input.attachments }))
      writeFileSync(this.queueFile, JSON.stringify(items))
    } catch {
      /* the queue is best effort */
    }
  }

  /** Puts the waiting items of the last session back in the queue. Items whose agent is gone are dropped. */
  restore(find: (agentId: string, chat?: boolean) => AgentDef | undefined): number {
    if (!this.queueFile || !existsSync(this.queueFile)) return 0
    let n = 0
    try {
      const items = JSON.parse(readFileSync(this.queueFile, 'utf8')) as { agentId: string; text: string; from: string; parentRunId?: string; chainId?: string; hops?: number; chat?: boolean; packet?: HandoffPacket; attachments?: string[] }[]
      writeFileSync(this.queueFile, '[]')
      for (const it of items) {
        const def = find(it.agentId, it.chat)
        if (!def) continue
        this.enqueue(def, it.text, { from: it.from, parentRunId: it.parentRunId, chainId: it.chainId, hops: it.hops, chat: it.chat, packet: it.packet, attachments: it.attachments })
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
    } else this.active.get(id)?.cancel()
  }

  /** App quit: stop everything but leave the saved queue as it is, so waiting items come back next time. */
  shutdown() {
    this.closing = true
    this.cancelAll()
  }

  cancelAll() {
    for (const { run } of [...this.queue]) this.cancel(run.id)
    for (const a of this.active.values()) a.cancel()
  }

  /** Lets a paused run start (once). */
  allow(id: string) {
    this.active.get(id)?.resume?.()
  }

  isBusy() {
    return this.active.size > 0 || this.queue.length > 0
  }

  /** Starts every queued run that may start now, in queue order. A waiting review run isn't overtaken, so it can't starve. */
  private pump() {
    for (;;) {
      if (this.active.size >= MAX_PARALLEL || [...this.active.values()].some((a) => a.exclusive)) return
      const busy = new Set([...this.active.values()].map((a) => a.run.agentId))
      const i = this.queue.findIndex((q) => !busy.has(q.def.id))
      if (i < 0) return
      const exclusive = needsReview(this.queue[i].def)
      if (exclusive && this.active.size > 0) return
      const [next] = this.queue.splice(i, 1)
      this.saveQueue()
      void this.runOne(next.run, next.def, exclusive)
    }
  }

  private async runOne(run: Run, def: AgentDef, exclusive: boolean) {
    let cancelled = false
    let stop: () => void = () => {}
    const slot: { run: Run; exclusive: boolean; cancel: () => void; resume?: () => void } = { run, exclusive, cancel: () => ((cancelled = true), stop()) }
    this.active.set(run.id, slot)
    try {
      const reason = this.gate ? await this.gate(run, def) : null
      if (reason) {
        // This run waits for the user (allow once, or skip); other runs carry on.
        run.status = 'paused'
        run.pauseReason = reason
        this.log(run, { type: 'paused', reason })
        this.onEvent('paused', run)
        this.onChange()
        await new Promise<void>((resolve, reject) => {
          slot.resume = resolve
          slot.cancel = () => ((cancelled = true), reject(new Error('Cancelled.')))
        })
        run.pauseReason = undefined
        slot.cancel = () => ((cancelled = true), stop())
      }
      run.status = 'running'
      run.startedAt = new Date().toISOString()
      this.log(run, { type: 'start', queueMs: Date.parse(run.startedAt) - Date.parse(run.queuedAt), parallel: this.active.size })
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
        { cancel: (fn) => (stop = fn), text: (t) => this.setPartial(run, t) }
      )
      run.usage = out.usage
      run.output = { from: def.id, to: run.input.from, text: out.text }
      this.finish(run, 'done')
    } catch (e) {
      const msg = (e as Error).message
      this.finish(run, cancelled || msg === 'Cancelled.' ? 'cancelled' : 'error', cancelled ? 'Cancelled.' : msg)
    } finally {
      this.active.delete(run.id)
      this.pump()
    }
  }

  private partialTimers = new Map<string, NodeJS.Timeout>()

  /** The answer so far, pushed to the UI at most every 150 ms (engines write many small chunks). */
  private setPartial(run: Run, text: string) {
    run.partial = text
    if (this.partialTimers.has(run.id)) return
    this.partialTimers.set(run.id, setTimeout(() => (this.partialTimers.delete(run.id), this.onChange()), 150))
  }

  private finish(run: Run, status: RunStatus, error?: string) {
    clearTimeout(this.partialTimers.get(run.id))
    this.partialTimers.delete(run.id)
    run.partial = undefined
    run.status = status
    run.error = status === 'done' ? undefined : error
    run.endedAt = new Date().toISOString()
    this.log(run, { type: 'end', status, profile: run.profile, error: run.error, output: run.output, usage: run.usage, outputFile: run.outputFile })
    // Speed side of the usage log: waiting in the queue vs running, and how many ran together (sizes and times only).
    const t = (iso?: string) => (iso ? Date.parse(iso) : undefined)
    const started = t(run.startedAt)
    metrics.event('run', {
      agent: run.agentId,
      status,
      chat: run.chat,
      hops: run.hops,
      from: run.input.from.startsWith('goal:') ? 'goal' : run.input.from,
      queueMs: started ? started - Date.parse(run.queuedAt) : undefined,
      runMs: started ? Date.parse(run.endedAt!) - started : undefined,
      outChars: run.output?.text.length,
      tools: run.progress.length
    })
    if (status === 'error') this.onEvent('failed', run)
    for (const w of this.waiters.get(run.id) ?? []) w(run)
    this.waiters.delete(run.id)
    if (this.runs.length > HISTORY_CAP) this.runs = this.runs.filter((r) => r.status === 'queued' || r.status === 'running' || this.runs.indexOf(r) >= this.runs.length - HISTORY_CAP)
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
