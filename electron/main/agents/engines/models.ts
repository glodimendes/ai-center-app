import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ollamaModels } from './ollama'

/** Cheapest models, chosen by the user for cost. Effort applies to this run only, not the global CLI config. Built-ins use these; a custom agent may choose its own. */
export const CONTEXT_MODELS = {
  codex: { model: 'gpt-5.6-luna', effort: 'medium' },
  claude: { model: 'claude-haiku-5-5', effort: 'medium' }
} as const

/** Effort levels each engine accepts (`--effort` for Claude, `model_reasoning_effort` for Codex). Others have none. */
export const EFFORTS: Record<string, string[]> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['minimal', 'low', 'medium', 'high', 'xhigh']
}

/** Claude CLI model ids offered in the agent editor (the CLI has no list command). */
export const CLAUDE_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2']

/** The models a profile can really run: Claude's fixed list, Codex's own cache (`models_cache.json`, entries marked listed), Ollama's server. Others (agy, custom command) choose their model themselves: empty. */
export async function availableModels(profile: { engine: string; configDir?: string; baseUrl?: string }, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  if (profile.engine === 'claude') return CLAUDE_MODELS
  if (profile.engine === 'codex') {
    try {
      const file = join(profile.configDir ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'models_cache.json')
      const list = (JSON.parse(readFileSync(file, 'utf8')).models ?? []) as { slug?: string; visibility?: string }[]
      const slugs = list.filter((m) => m.slug && m.visibility !== 'hide').map((m) => m.slug as string)
      if (slugs.length) return slugs
    } catch {
      /* no cache yet: fall back to the built-in model */
    }
    return [CONTEXT_MODELS.codex.model]
  }
  if (profile.engine === 'ollama') return ollamaModels(profile.baseUrl, fetchImpl)
  return []
}
