import type { ContextEngine } from '@shared/types'
import { ENGINES, EngineTimeout, failureMessage, runEngine } from '../agents/engines'
import { findProfile } from '../agents/profiles'

/**
 * One question whose answer is JSON the app parses; the user approves every change.
 * Claude Haiku runs with no tools and no connectors, so it sees only the text we send. Codex can't turn
 * its shell off: it runs in its read-only sandbox (no writes, no network) from an empty folder.
 */
export async function askJson<T>(engine: ContextEngine, prompt: string, timeoutMs = 120_000): Promise<T> {
  const profile = findProfile(engine)
  try {
    const run = await runEngine(ENGINES[profile.engine], { profile, mode: 'ask', purpose: 'ask', prompt, cwd: process.cwd(), timeoutMs })
    const r = await run.done
    const tail = r.code !== 0 || !r.text ? failureMessage(r.stderr, r.code, profile.engine) : ''
    if (profile.engine === 'claude') {
      if (r.isError) throw new Error(r.text || 'The model returned an error.')
      if (!r.text && r.code !== 0) throw new Error(tail)
    } else if (r.code !== 0 || !r.text) throw new Error(tail)
    return parseJsonAnswer<T>(r.text)
  } catch (e) {
    throw e instanceof EngineTimeout ? new Error(`No answer within ${Math.round(timeoutMs / 1000)} s. Try again.`) : e
  }
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
