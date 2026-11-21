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
