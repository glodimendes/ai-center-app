import { describe, expect, it } from 'vitest'
import { claudeCli } from '../electron/main/agents/engines/claude-cli'
import { codexCli } from '../electron/main/agents/engines/codex-cli'
import { profileEnv } from '../electron/main/agents/engines/process'
import { DEFAULT_PROFILES, findProfile } from '../electron/main/agents/profiles'
import type { RunSpec } from '../electron/main/agents/engines/types'

const spec = (mode: RunSpec['mode'], engine: 'claude' | 'codex', extra: Partial<RunSpec> = {}): RunSpec => ({ profile: findProfile(engine), mode, prompt: 'P', cwd: '/vault', timeoutMs: 1000, ...extra })
const after = (args: string[], flag: string, n = 1) => args.slice(args.indexOf(flag) + 1, args.indexOf(flag) + 1 + n)

describe('claude engine', () => {
  it('ask mode: no tools, no connectors, json envelope, cheapest model', () => {
    const p = claudeCli.prepare(spec('ask', 'claude'))
    expect(p.output).toBe('json')
    expect(after(p.args, '--model')).toEqual(['claude-haiku-5-5'])
    expect(after(p.args, '--tools')).toEqual([''])
    expect(p.args).toContain('--strict-mcp-config')
  })
  it('edit mode: file tools only, shell and web blocked', () => {
    const p = claudeCli.prepare(spec('edit', 'claude'))
    expect(p.cwd).toBe('/vault')
    expect(after(p.args, '--allowedTools', 5)).toEqual(['Read', 'Edit', 'Write', 'Glob', 'Grep'])
    expect(after(p.args, '--disallowedTools', 3)).toEqual(['Bash', 'WebFetch', 'WebSearch'])
    expect(after(p.args, '--permission-mode')).toEqual(['acceptEdits'])
  })
  it('tools mode passes exactly the given tool lists and never edits', () => {
    const p = claudeCli.prepare(spec('tools', 'claude', { allowedTools: ['Read', 'Grep'], disallowedTools: ['Bash'] }))
    expect(after(p.args, '--allowedTools', 2)).toEqual(['Read', 'Grep'])
    expect(after(p.args, '--disallowedTools')).toEqual(['Bash'])
    expect(p.args).not.toContain('--permission-mode')
  })
  it('parses tool use, usage and the result from recorded stream-json lines', () => {
    const tool = claudeCli.parse({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_use', name: 'Edit', input: { file_path: '/vault/a.md' } }, { type: 'tool_use', name: 'Grep', input: { pattern: 'foo' } }] } })
    expect(tool).toEqual([
      { type: 'tool', name: 'Edit', target: '/vault/a.md' },
      { type: 'tool', name: 'Grep', target: 'foo' }
    ])
    expect(claudeCli.parse({ type: 'result', result: 'ok', is_error: false, total_cost_usd: 0.01, usage: { input_tokens: 5, output_tokens: 7 } })).toEqual([
      { type: 'usage', usage: { inputTokens: 5, outputTokens: 7, costUsd: 0.01 } },
      { type: 'done', text: 'ok', isError: false }
    ])
    expect(claudeCli.parse({ type: 'result', result: 'bad', is_error: true })[0]).toEqual({ type: 'done', text: 'bad', isError: true })
    expect(claudeCli.parse({ type: 'system' })).toEqual([])
  })
})

describe('codex engine', () => {
  it('edit mode: workspace-write in the vault, json events, cheapest model', () => {
    const p = codexCli.prepare(spec('edit', 'codex'))
    expect(p.cwd).toBe('/vault')
    expect(after(p.args, '-s')).toEqual(['workspace-write'])
    expect(after(p.args, '-m')).toEqual(['gpt-5.6-luna'])
    expect(p.args).toContain('--json')
    expect(p.output).toBe('stream')
    expect(p.lastMessageFile && p.args).toContain(p.lastMessageFile)
  })
  it('ask mode: read-only from an empty temp folder, not the vault', () => {
    const p = codexCli.prepare(spec('ask', 'codex'))
    expect(after(p.args, '-s')).toEqual(['read-only'])
    expect(p.cwd).not.toBe('/vault')
    expect(after(p.args, '-C')).toEqual([p.cwd])
    expect(p.args).not.toContain('--json')
    expect(p.output).toBe('none')
  })
  it("refuses tools mode: Codex can't limit tools", () => {
    expect(() => codexCli.prepare(spec('tools', 'codex'))).toThrow(/per-tool/)
  })
  it('parses file changes, the final message and token counts', () => {
    expect(codexCli.parse({ item: { type: 'file_change', changes: [{ path: '/vault/a.md' }, { path: '/vault/b.md' }] } })).toEqual([
      { type: 'file_change', path: '/vault/a.md' },
      { type: 'file_change', path: '/vault/b.md' }
    ])
    expect(codexCli.parse({ msg: { type: 'agent_message', text: 'done' } })).toEqual([{ type: 'text', text: 'done' }])
    expect(codexCli.parse({ msg: { type: 'token_count', info: { total_token_usage: { input_tokens: 3, output_tokens: 4 } } } })).toEqual([{ type: 'usage', usage: { inputTokens: 3, outputTokens: 4 } }])
    expect(codexCli.parse({ msg: { type: 'agent_message', text: '' } })).toEqual([])
  })
})

describe('account profiles', () => {
  it('default profiles keep each CLI on its own default login', () => {
    expect(DEFAULT_PROFILES.map((p) => p.id)).toEqual(['claude', 'codex'])
    expect(profileEnv(findProfile('claude')).CLAUDE_CONFIG_DIR).toBe(process.env.CLAUDE_CONFIG_DIR)
  })
  it('a configDir points Claude at CLAUDE_CONFIG_DIR and Codex at CODEX_HOME', () => {
    expect(profileEnv({ id: 'eth', engine: 'claude', label: 'ETH', configDir: '/h/.claude-eth' }).CLAUDE_CONFIG_DIR).toBe('/h/.claude-eth')
    expect(profileEnv({ id: 'c', engine: 'codex', label: 'C', configDir: '/h/.codex' }).CODEX_HOME).toBe('/h/.codex')
  })
  it('an unknown profile id is an error', () => {
    expect(() => findProfile('nope')).toThrow(/nope/)
  })
})

describe('chat sessions', () => {
  const base = { prompt: 'P', cwd: '/vault', timeoutMs: 1 }
  it('Claude: the first turn names a session id, later turns resume it, and no other run keeps a session', () => {
    const first = claudeCli.prepare({ ...spec('read', 'claude'), ...base, session: { id: 'abc', resume: false } })
    expect(after(first.args, '--session-id')).toEqual(['abc'])
    expect(first.args).not.toContain('--no-session-persistence')
    const next = claudeCli.prepare({ ...spec('read', 'claude'), ...base, session: { id: 'abc', resume: true } })
    expect(after(next.args, '--resume')).toEqual(['abc'])
    expect(claudeCli.prepare(spec('read', 'claude')).args).toContain('--no-session-persistence')
  })
  it('Codex: the first turn keeps its thread (not ephemeral, json) and later turns resume it with the sandbox as config', () => {
    const first = codexCli.prepare({ ...spec('read', 'codex'), session: { id: '', resume: false } })
    expect(first.args).not.toContain('--ephemeral')
    expect(first.args).toContain('--json')
    expect(after(first.args, '-s')).toEqual(['read-only'])
    const next = codexCli.prepare({ ...spec('read', 'codex'), session: { id: 'thread-1', resume: true } })
    expect(next.args.slice(0, 2)).toEqual(['exec', 'resume'])
    expect(next.args).toContain('thread-1')
    expect(next.args).toContain('sandbox_mode="read-only"')
    expect(next.args).not.toContain('-s')
    expect(spec('read', 'codex')).toBeTruthy()
    expect(codexCli.parse({ type: 'thread.started', thread_id: 'thread-1' })).toEqual([{ type: 'session', id: 'thread-1' }])
  })
})

import { agyCli } from '../electron/main/agents/engines/agy-cli'
import { commandEngine } from '../electron/main/agents/engines/command'
import { keepAliveValue, ollamaEngine, ollamaModels } from '../electron/main/agents/engines/ollama'
import { ENGINES } from '../electron/main/agents/engines'
import type { AccountProfile } from '../electron/main/agents/engines/types'

const prof = (p: Partial<AccountProfile> & Pick<AccountProfile, 'engine'>): AccountProfile => ({ id: p.engine, label: p.engine, ...p })
const run = (profile: AccountProfile, mode: RunSpec['mode'], extra: Partial<RunSpec> = {}): RunSpec => ({ profile, mode, prompt: 'P', cwd: '/vault', timeoutMs: 1000, ...extra })

describe('antigravity engine', () => {
  it('read runs use plan mode with the sandbox, edits use accept-edits, tools mode is refused', () => {
    const r = agyCli.prepare(run(prof({ engine: 'agy' }), 'read'))
    expect(r.binary).toBe('agy')
    expect(after(r.args, '--mode')).toEqual(['plan'])
    expect(r.args).toContain('--sandbox')
    expect(after(r.args, '--output-format')).toEqual(['stream-json'])
    expect(after(agyCli.prepare(run(prof({ engine: 'agy' }), 'edit')).args, '--mode')).toEqual(['accept-edits'])
    expect(() => agyCli.prepare(run(prof({ engine: 'agy' }), 'tools'))).toThrow(/per-tool/)
  })
  it('model comes from the profile or the agent, and a chat resumes by conversation id', () => {
    expect(after(agyCli.prepare(run(prof({ engine: 'agy', model: 'm1' }), 'read')).args, '--model')).toEqual(['m1'])
    expect(after(agyCli.prepare(run(prof({ engine: 'agy', model: 'm1' }), 'read', { model: 'm2' })).args, '--model')).toEqual(['m2'])
    expect(after(agyCli.prepare(run(prof({ engine: 'agy' }), 'read', { session: { id: 'conv-1', resume: true } })).args, '--conversation')).toEqual(['conv-1'])
  })
  it('parses the conversation id, steps, usage and the result from recorded lines', () => {
    expect(agyCli.parse({ event: 'init', init: { conversation_id: 'c1', tools: [] } })).toEqual([{ type: 'session', id: 'c1' }])
    expect(agyCli.parse({ event: 'step_update', step_update: { state: 'ACTIVE', step_type: 'run_command' } })).toEqual([{ type: 'tool', name: 'run_command', target: '' }])
    expect(agyCli.parse({ event: 'step_update', step_update: { state: 'ACTIVE', step_type: 'agent_response', text_delta: 'ok' } })).toEqual([])
    const done = agyCli.parse({ event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', response: 'ok\n', usage: { input_tokens: 9, output_tokens: 2 } } })
    expect(done).toContainEqual({ type: 'done', text: 'ok', isError: false })
    expect(done).toContainEqual({ type: 'usage', usage: { inputTokens: 9, outputTokens: 2 } })
    expect(agyCli.parse({ event: 'result', result: { status: 'ERROR', response: 'x' } }).at(-1)).toMatchObject({ isError: true })
  })
})

describe('custom command engine', () => {
  it('substitutes {prompt} or appends it, and refuses edit and tools modes', () => {
    const a = commandEngine.prepare(run(prof({ engine: 'command', command: ['mycli', '--ask', '{prompt}', '-v'] }), 'ask'))
    expect([a.binary, ...a.args]).toEqual(['mycli', '--ask', 'P', '-v'])
    expect(a.output).toBe('text')
    expect(commandEngine.prepare(run(prof({ engine: 'command', command: ['mycli'] }), 'read')).args).toEqual(['P'])
    expect(() => commandEngine.prepare(run(prof({ engine: 'command', command: ['mycli'] }), 'edit'))).toThrow(/can't be limited/)
    expect(() => commandEngine.prepare(run(prof({ engine: 'command' }), 'ask'))).toThrow(/Set the command/)
  })
  it('no engine except the CLIs with session flags offers chat', () => {
    expect(Object.fromEntries(Object.entries(ENGINES).map(([k, e]) => [k, e.chat]))).toEqual({ claude: true, codex: true, agy: true, ollama: false, command: false })
  })
})

describe('ollama engine', () => {
  const stream = (lines: object[]) => new Response(new ReadableStream({ start(c) { for (const l of lines) c.enqueue(new TextEncoder().encode(JSON.stringify(l) + '\n')); c.close() } }))
  it('streams text, sends the model and keep_alive, and reports tokens', async () => {
    let sent: any
    const fake = (async (url: string, init: any) => ((sent = { url, body: JSON.parse(init.body) }), stream([{ message: { content: 'Hel' } }, { message: { content: 'lo' } }, { done: true, prompt_eval_count: 7, eval_count: 3 }]))) as unknown as typeof fetch
    const events: string[] = []
    const r = await (await ollamaEngine.run!({ ...run(prof({ engine: 'ollama', model: 'qwen3:4b', baseUrl: 'http://h:1/' }), 'ask'), onEvent: (e) => events.push(e.type) }, fake)).done
    expect(r).toMatchObject({ text: 'Hello', usage: { inputTokens: 7, outputTokens: 3 }, isError: false })
    expect(sent.url).toBe('http://h:1/api/chat')
    expect(sent.body).toMatchObject({ model: 'qwen3:4b', stream: true, keep_alive: 0, messages: [{ role: 'user', content: 'P' }] })
    expect(events).toContain('usage')
  })
  it('keep_alive: 0 by default, numbers as numbers, durations as text', () => {
    expect([keepAliveValue(undefined), keepAliveValue(''), keepAliveValue('0'), keepAliveValue('300'), keepAliveValue('5m')]).toEqual([0, 0, 0, 300, '5m'])
  })
  it('is text-only, needs a model, and explains an unreachable server', async () => {
    await expect(ollamaEngine.run!(run(prof({ engine: 'ollama', model: 'm' }), 'edit'))).rejects.toThrow(/text-only/)
    await expect(ollamaEngine.run!(run(prof({ engine: 'ollama' }), 'ask'))).rejects.toThrow(/Choose a model/)
    const down = (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
    await expect((await ollamaEngine.run!(run(prof({ engine: 'ollama', model: 'm' }), 'ask'), down)).done).rejects.toThrow(/Can't reach Ollama/)
  })
  it('lists installed models', async () => {
    const fake = (async () => new Response(JSON.stringify({ models: [{ name: 'a:1' }, { name: 'b:2' }] }))) as unknown as typeof fetch
    expect(await ollamaModels(undefined, fake)).toEqual(['a:1', 'b:2'])
  })
})

describe('codex failures', () => {
  it('turns a failed turn into an error with its message', async () => {
    const { codexCli } = await import('../electron/main/agents/engines/codex-cli')
    expect(codexCli.parse({ type: 'turn.failed', error: { message: "The '6.0 Luna' model is not supported." } })).toEqual([{ type: 'done', text: "The '6.0 Luna' model is not supported.", isError: true }])
  })
})
