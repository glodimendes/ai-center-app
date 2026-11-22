import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { availableModels, CLAUDE_MODELS } from '../electron/main/agents/engines/models'

describe('availableModels', () => {
  it('lists the Claude models', async () => {
    expect(await availableModels({ engine: 'claude' })).toEqual(CLAUDE_MODELS)
  })
  it("reads Codex's own cache and skips hidden models", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-'))
    writeFileSync(join(dir, 'models_cache.json'), JSON.stringify({ models: [{ slug: 'a', visibility: 'list' }, { slug: 'b', visibility: 'hide' }, { slug: 'c' }] }))
    expect(await availableModels({ engine: 'codex', configDir: dir })).toEqual(['a', 'c'])
  })
  it('falls back to the built-in Codex model without a cache', async () => {
    expect(await availableModels({ engine: 'codex', configDir: mkdtempSync(join(tmpdir(), 'codex-')) })).toEqual(['gpt-5.6-luna'])
  })
  it('asks Ollama for its models and leaves other engines without a list', async () => {
    const fetchImpl = (async () => ({ ok: true, json: async () => ({ models: [{ name: 'llama3' }] }) })) as unknown as typeof fetch
    expect(await availableModels({ engine: 'ollama' }, fetchImpl)).toEqual(['llama3'])
    expect(await availableModels({ engine: 'agy' })).toEqual([])
  })
})
