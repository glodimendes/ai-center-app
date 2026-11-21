import type { Engine, EngineRun, RunSpec, Usage } from './types'
import { EngineTimeout } from './process'

const DEFAULT_URL = 'http://127.0.0.1:11434'

/** `0` unloads the model right after the run; a number of seconds or a duration like `5m` keeps it loaded. */
export const keepAliveValue = (v?: string): number | string => (v === undefined || v === '' ? 0 : /^\d+$/.test(v) ? Number(v) : v)

/**
 * Ollama, a local model over its HTTP API. Text only: it sees the prompt (instructions, sources, input) and nothing else,
 * so it can answer but not read the vault or edit files. Memory is used only while it works unless keepAlive says otherwise.
 */
export const ollamaEngine: Engine = {
  id: 'ollama',
  chat: false,
  prepare() {
    throw new Error('Ollama runs over HTTP.')
  },
  parse: () => [],
  async run(spec: RunSpec, fetchImpl: typeof fetch = fetch): Promise<EngineRun> {
    if (spec.mode === 'edit' || spec.mode === 'tools') throw new Error('Ollama is text-only: it can\'t edit files or use tools, so agents with propose/act permission need another engine.')
    const model = spec.model ?? spec.profile.model
    if (!model) throw new Error('Choose a model for this Ollama profile in Settings → Engines & accounts.')
    const base = (spec.profile.baseUrl || DEFAULT_URL).replace(/\/$/, '')
    const ctl = new AbortController()
    let cancelled = false
    let timedOut = false
    const timer = setTimeout(() => ((timedOut = true), ctl.abort()), spec.timeoutMs)
    const done = (async () => {
      try {
        const res = await fetchImpl(`${base}/api/chat`, {
          method: 'POST',
          signal: ctl.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: spec.prompt }], stream: true, keep_alive: keepAliveValue(spec.profile.keepAlive) })
        })
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          throw new Error(`Ollama answered ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
        }
        let text = ''
        let usage: Usage | undefined
        let buf = ''
        const decoder = new TextDecoder()
        const handle = (line: string) => {
          if (!line.trim()) return
          const j = JSON.parse(line)
          if (j.error) throw new Error(String(j.error))
          if (j.message?.content) {
            text += j.message.content
            spec.onEvent?.({ type: 'text', text })
          }
          if (j.done) usage = { inputTokens: j.prompt_eval_count, outputTokens: j.eval_count }
        }
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          buf += decoder.decode(chunk, { stream: true })
          let nl: number
          while ((nl = buf.indexOf('\n')) >= 0) {
            handle(buf.slice(0, nl))
            buf = buf.slice(nl + 1)
          }
        }
        handle(buf)
        if (usage) spec.onEvent?.({ type: 'usage', usage })
        return { text: text.trim(), isError: false, usage, code: 0, stderr: '' }
      } catch (e) {
        if (timedOut) throw new EngineTimeout(spec.timeoutMs)
        if (cancelled) throw new Error('Cancelled.')
        const msg = (e as Error).message
        throw new Error(/fetch failed|ECONNREFUSED/.test(msg) ? `Can't reach Ollama at ${base}. Is it running?` : msg)
      } finally {
        clearTimeout(timer)
      }
    })()
    return { done, cancel: () => ((cancelled = true), ctl.abort()) }
  }
}

/** Models installed on the server, for Settings and Test. */
export async function ollamaModels(baseUrl: string | undefined, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const res = await fetchImpl(`${(baseUrl || DEFAULT_URL).replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(4000) })
  if (!res.ok) throw new Error(`Ollama answered ${res.status}.`)
  return ((await res.json()) as { models?: { name: string }[] }).models?.map((m) => m.name) ?? []
}
