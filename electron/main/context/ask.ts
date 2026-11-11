import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ContextEngine } from '@shared/types'
import { CONTEXT_MODELS, keepTail, resolveBinary, stop } from './agent'

/**
 * One question whose answer is JSON the app parses; the user approves every change.
 * Claude Haiku runs with no tools and no connectors, so it sees only the text we send. Codex can't turn
 * its shell off: it runs in its read-only sandbox (no writes, no network) from an empty folder.
 */
export async function askJson<T>(engine: ContextEngine, prompt: string, timeoutMs = 120_000): Promise<T> {
  const text = engine === 'codex' ? await askCodex(prompt, timeoutMs) : await askClaude(prompt, timeoutMs)
  return parseJsonAnswer<T>(text)
}

async function askClaude(prompt: string, timeoutMs: number): Promise<string> {
  const bin = await resolveBinary('claude')
  const child = spawn(
    bin,
    ['-p', prompt, '--model', CONTEXT_MODELS.claude.model, '--effort', CONTEXT_MODELS.claude.effort, '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  const { out, err, code } = await finish(child, timeoutMs)
  try {
    const env = JSON.parse(out)
    if (env.is_error) throw new Error(String(env.result ?? 'The model returned an error.'))
    return String(env.result ?? '')
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error(err.trim().split('\n').slice(-2).join(' ') || `claude exited with code ${code}.`)
    throw e
  }
}

async function askCodex(prompt: string, timeoutMs: number): Promise<string> {
  const bin = await resolveBinary('codex')
  const dir = mkdtempSync(join(tmpdir(), 'planner-ask-'))
  const last = join(dir, 'last.txt')
  try {
    const child = spawn(
      bin,
      ['exec', '-m', CONTEXT_MODELS.codex.model, '-c', `model_reasoning_effort="${CONTEXT_MODELS.codex.effort}"`, '-C', dir, '-s', 'read-only', '--skip-git-repo-check', '--ephemeral', '-o', last, prompt],
      { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    const { err, code } = await finish(child, timeoutMs)
    const text = existsSync(last) ? readFileSync(last, 'utf8') : ''
    if (code !== 0 || !text.trim()) throw new Error(err.trim().split('\n').slice(-2).join(' ') || `codex exited with code ${code}.`)
    return text
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function finish(child: ChildProcess, timeoutMs: number): Promise<{ out: string; err: string; code: number | null }> {
  let out = ''
  let err = ''
  child.stdout!.on('data', (c: Buffer) => (out += c.toString()))
  child.stderr!.on('data', (c: Buffer) => (err = keepTail(err + c.toString())))
  return new Promise((resolve, reject) => {
    let timedOut = false
    const timer = setTimeout(() => ((timedOut = true), stop(child)), timeoutMs)
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) return reject(new Error(`No answer within ${Math.round(timeoutMs / 1000)} s. Try again.`))
      resolve({ out, err, code })
    })
  })
}

/** The answer's JSON, also when wrapped in a ```json fence or a sentence. */
export function parseJsonAnswer<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.search(/[[{]/)
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
  if (start < 0 || end < start) throw new Error("The model's answer had no JSON in it. Try again.")
  return JSON.parse(body.slice(start, end + 1)) as T
}
