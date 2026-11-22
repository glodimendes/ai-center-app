import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { promisify } from 'node:util'
import { metrics } from '../../metrics'
import type { AccountProfile, Engine, EngineEvent, EngineRun, RunResult, RunSpec, Usage } from './types'

const exec = promisify(execFile)

/** The packaged app doesn't inherit the shell PATH, so ask a login shell where the CLI lives. */
export async function resolveBinary(name: string): Promise<string> {
  for (const p of [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]) if (existsSync(p)) return p
  const { stdout } = await exec('/bin/zsh', ['-lc', `command -v ${name}`])
  const p = stdout.trim()
  if (!p) throw new Error(`Couldn't find the "${name}" command. Install it or switch the engine in Settings.`)
  return p
}

/** SIGTERM, then SIGKILL if the CLI hasn't exited 5 s later, so a stuck run can't hold up quitting. */
export function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const t = setTimeout(() => child.exitCode === null && child.signalCode === null && child.kill('SIGKILL'), 5000)
  child.once('close', () => clearTimeout(t))
}

/** Only the tail of stderr matters for an error message. */
export const keepTail = (s: string) => (s.length > 16_000 ? s.slice(-8_000) : s)

/** CLI chatter that says nothing about why a run failed (Codex prints its banner and "Reading additional input from stdin..." on every run). */
const NOISE = /^(reading (additional input|prompt) from stdin|openai codex v|-{3,}|(workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|session id):|tokens used|user$|codex$)/i

/** A readable reason from a failed run's stderr: the real error line if there is one, never just the banner. */
export function failureMessage(stderr: string, code: number | null, cli = 'The CLI'): string {
  const lines = stderr.split('\n').map((l) => l.trim()).filter((l) => l && !NOISE.test(l))
  const errors = lines.filter((l) => /error|fail|denied|limit|quota|unauthori|log ?in|not found|invalid/i.test(l))
  const pick = (errors.length ? errors : lines).slice(-2).join(' ')
  return pick || `${cli} stopped (exit code ${code ?? '?'}) without an answer. Check that its account is logged in, or run it once in a terminal.`
}

/** Env that points a CLI at the profile's own login; nothing set means the CLI's default account. */
export function profileEnv(profile: AccountProfile): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (profile.configDir && (profile.engine === 'claude' || profile.engine === 'codex')) env[profile.engine === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'] = profile.configDir
  return env
}

export class EngineTimeout extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Stopped after ${Math.round(timeoutMs / 1000)} s.`)
  }
}

/** Starts the run. Rejects with EngineTimeout, Error('Cancelled.') or the spawn error; a failed exit code resolves, callers decide. */
export async function runEngine(engine: Engine, spec: RunSpec): Promise<EngineRun> {
  // Every model call of the app goes through here, so this is the one place that logs speed and tokens (sizes only, never text).
  const t0 = performance.now()
  let first: number | undefined
  const run = await runEngineRaw(engine, { ...spec, onEvent: (ev) => ((first ??= performance.now() - t0), spec.onEvent?.(ev)) })
  const log = (r?: RunResult, error?: string) => {
    const u = r?.usage
    metrics.event('ai', {
      purpose: spec.purpose ?? 'other',
      engine: engine.id,
      model: spec.model ?? spec.profile.model,
      mode: spec.mode,
      resumed: spec.session?.resume,
      promptChars: spec.prompt.length,
      addDirs: spec.addDirs?.length,
      ms: performance.now() - t0,
      firstOutputMs: first,
      inputTokens: u?.inputTokens,
      outputTokens: u?.outputTokens,
      cacheReadTokens: u?.cacheReadTokens,
      cacheWriteTokens: u?.cacheWriteTokens,
      costUsd: u?.costUsd,
      exit: r?.code,
      failed: r ? r.isError || (r.code !== 0 && !r.text) : true,
      error: error?.slice(0, 60)
    })
  }
  void run.done.then((r) => log(r), (e) => log(undefined, e instanceof EngineTimeout ? 'timeout' : (e as Error).message === 'Cancelled.' ? 'cancelled' : 'error'))
  return run
}

async function runEngineRaw(engine: Engine, spec: RunSpec): Promise<EngineRun> {
  if (engine.run) return engine.run(spec)
  const prep = engine.prepare(spec)
  const bin = await resolveBinary(prep.binary)
  const child = spawn(bin, prep.args, { cwd: prep.cwd, env: profileEnv(spec.profile), stdio: ['ignore', 'pipe', 'pipe'] })

  let text = ''
  let isError = false
  let usage: Usage | undefined
  let sessionId: string | undefined = spec.session?.id
  let stderr = ''
  let buf = ''
  let all = ''
  const emit = (ev: EngineEvent) => {
    if (ev.type === 'done') ((text = ev.text), (isError = ev.isError))
    else if (ev.type === 'text') text = ev.text
    else if (ev.type === 'usage') usage = { ...usage, ...ev.usage }
    else if (ev.type === 'session') sessionId = ev.id
    spec.onEvent?.(ev)
  }
  const feed = (line: string) => {
    try {
      for (const ev of engine.parse(JSON.parse(line))) emit(ev)
    } catch {
      /* non-JSON noise */
    }
  }
  child.stdout!.on('data', (chunk: Buffer) => {
    if (prep.output === 'none') return
    if (prep.output === 'json' || prep.output === 'text') return void (all += chunk.toString())
    buf += chunk.toString()
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line) feed(line)
    }
  })
  child.stderr!.on('data', (c: Buffer) => (stderr = keepTail(stderr + c.toString())))

  const cleanup = () => prep.tempDir && rmSync(prep.tempDir, { recursive: true, force: true })
  const done = new Promise<RunResult>((resolve, reject) => {
    let timedOut = false
    const timer = setTimeout(() => ((timedOut = true), stop(child)), spec.timeoutMs)
    child.on('error', (e) => (clearTimeout(timer), cleanup(), reject(e)))
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (prep.output === 'json') feed(all)
      if (prep.output === 'text') text = all
      if (prep.lastMessageFile && existsSync(prep.lastMessageFile)) text = readFileSync(prep.lastMessageFile, 'utf8').trim() || text
      cleanup()
      if (timedOut) return reject(new EngineTimeout(spec.timeoutMs))
      if (signal) return reject(new Error('Cancelled.'))
      resolve({ text: text.trim(), isError, usage, sessionId, code, stderr })
    })
  })
  return { done, cancel: () => stop(child) }
}
