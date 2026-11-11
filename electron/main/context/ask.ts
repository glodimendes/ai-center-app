import { spawn } from 'node:child_process'
import { CONTEXT_MODELS, keepTail, resolveBinary, stop } from './agent'

/**
 * One question to Claude Haiku with no tools and no connectors: it sees only the text we send and
 * can't read or change anything. Answers are JSON the app parses; the user approves every change.
 */
export async function askJson<T>(prompt: string, timeoutMs = 120_000): Promise<T> {
  const bin = await resolveBinary('claude')
  const child = spawn(
    bin,
    ['-p', prompt, '--model', CONTEXT_MODELS.claude.model, '--effort', CONTEXT_MODELS.claude.effort, '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let out = ''
  let err = ''
  child.stdout!.on('data', (c: Buffer) => (out += c.toString()))
  child.stderr!.on('data', (c: Buffer) => (err = keepTail(err + c.toString())))
  const text = await new Promise<string>((resolve, reject) => {
    let timedOut = false
    const timer = setTimeout(() => ((timedOut = true), stop(child)), timeoutMs)
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) return reject(new Error(`No answer within ${Math.round(timeoutMs / 1000)} s. Try again.`))
      try {
        const env = JSON.parse(out)
        if (env.is_error) return reject(new Error(String(env.result ?? 'The model returned an error.')))
        resolve(String(env.result ?? ''))
      } catch {
        reject(new Error(err.trim().split('\n').slice(-2).join(' ') || `claude exited with code ${code}.`))
      }
    })
  })
  return parseJsonAnswer<T>(text)
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
