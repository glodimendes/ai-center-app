import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentError, parseAgent, serializeAgent } from '../electron/main/agents/definition'
import { AgentRegistry } from '../electron/main/agents/registry'
import { ApprovalStore, parseActions } from '../electron/main/agents/actions'
import { canAutoRun, engineMode, needsReview } from '../electron/main/agents/permissions'
import { Supervisor, type Execute } from '../electron/main/agents/supervisor'
import { buildPrompt } from '../electron/main/agents/runner'
import { claudeCli } from '../electron/main/agents/engines/claude-cli'
import { codexCli } from '../electron/main/agents/engines/codex-cli'
import { findProfile } from '../electron/main/agents/profiles'

const tmp = () => mkdtempSync(join(tmpdir(), 'agents-test-'))
const FILE = `---
name: Email triage
profile: claude
permission: propose
output: actions
triggers: [manual, "schedule: 07:00"]
budget: 20
---

Look at my mail and suggest tasks.
`

describe('agent definitions', () => {
  it('parses frontmatter and instructions, with defaults', () => {
    const a = parseAgent('email-triage', FILE)
    expect(a).toMatchObject({ id: 'email-triage', name: 'Email triage', profile: 'claude', permission: 'propose', output: 'actions', budget: 20, sources: [] })
    expect(a.triggers).toEqual(['manual', 'schedule: 07:00'])
    expect(a.instructions).toBe('Look at my mail and suggest tasks.')
    const min = parseAgent('x', '---\nname: X\n---\nDo it.')
    expect(min).toMatchObject({ permission: 'read', output: 'reply', profile: 'claude', triggers: ['manual'] })
  })
  it('round-trips through serialize', () => {
    const a = parseAgent('email-triage', FILE)
    expect(parseAgent('email-triage', serializeAgent(a))).toEqual(a)
  })
  it('rejects bad files with a readable message', () => {
    expect(() => parseAgent('a', 'no frontmatter')).toThrow(/frontmatter/)
    expect(() => parseAgent('a', '---\npermission: root\n---\nx')).toThrow(/permission/)
    expect(() => parseAgent('a', '---\nname: A\n---\n')).toThrow(/empty/)
    expect(() => parseAgent('a', '---\nworkdir: ../out\n---\nx')).toThrow(/inside the vault/)
    expect(() => parseAgent('a', '---\nbudget: 400\n---\nx')).toThrow(/budget/)
    expect(() => parseAgent('Bad Id', FILE)).toThrow(AgentError)
  })
})

describe('registry', () => {
  it('lists valid agents, reports bad files separately, saves and removes', () => {
    const dir = tmp()
    const reg = new AgentRegistry(() => join(dir, 'agents'))
    expect(reg.list()).toEqual({ agents: [], errors: [] })
    reg.save(parseAgent('good', FILE))
    writeFileSync(join(dir, 'agents', 'broken.md'), 'nope')
    const l = reg.list()
    expect(l.agents.map((a) => a.id)).toEqual(['good'])
    expect(l.errors[0]).toMatchObject({ id: 'broken' })
    expect(reg.get('good')?.name).toBe('Email triage')
    reg.remove('good')
    expect(reg.get('good')).toBeUndefined()
    expect(() => reg.remove('../escape')).toThrow()
    rmSync(dir, { recursive: true })
  })
})

describe('permissions', () => {
  it('read agents get the read-only engine mode; propose and act edit', () => {
    expect(engineMode('read')).toBe('read')
    expect(engineMode('propose')).toBe('edit')
    expect(engineMode('act')).toBe('edit')
    expect(needsReview({ permission: 'propose' })).toBe(true)
    expect(needsReview({ permission: 'act' })).toBe(true)
    expect(needsReview({ permission: 'read' })).toBe(false)
  })
  it('read mode cannot write: Claude has no edit tools, Codex is read-only', () => {
    const spec = { profile: findProfile('claude'), mode: 'read' as const, prompt: 'p', cwd: '/v', timeoutMs: 1 }
    const c = claudeCli.prepare(spec)
    const allowed = c.args.slice(c.args.indexOf('--allowedTools') + 1, c.args.indexOf('--disallowedTools'))
    expect(allowed).toEqual(['Read', 'Glob', 'Grep'])
    expect(c.args.slice(c.args.indexOf('--disallowedTools'))).toEqual(expect.arrayContaining(['Edit', 'Write', 'Bash']))
    const x = codexCli.prepare({ ...spec, profile: findProfile('codex') })
    expect(x.args[x.args.indexOf('-s') + 1]).toBe('read-only')
    expect(x.cwd).toBe('/v')
  })
  it('a per-agent model overrides the cheap default', () => {
    const c = claudeCli.prepare({ profile: findProfile('claude'), mode: 'read', prompt: 'p', cwd: '/v', timeoutMs: 1, model: 'claude-opus-5-5', effort: 'high' })
    expect(c.args[c.args.indexOf('--model') + 1]).toBe('claude-opus-5-5')
    expect(c.args[c.args.indexOf('--effort') + 1]).toBe('high')
  })
  it('only adding a task may run without a click, and only for act', () => {
    for (const kind of ['complete-task', 'create-event', 'email-draft', 'api-call'] as const) for (const p of ['read', 'propose', 'act'] as const) expect(canAutoRun(kind, p)).toBe(false)
    expect(canAutoRun('add-task', 'act')).toBe(true)
    expect(canAutoRun('add-task', 'propose')).toBe(false)
  })
})

describe('actions and approvals', () => {
  it('parses the actions block and drops bad entries', () => {
    const r = parseActions('Done.\n```actions\n[{"kind":"add-task","title":"A","payload":{"body":"x"}},{"kind":"rm-rf","title":"B"},{"kind":"email-draft"}]\n```')
    expect(r.text).toBe('Done.')
    expect(r.actions).toEqual([{ kind: 'add-task', title: 'A', payload: { body: 'x' } }])
    expect(parseActions('The answer.\n\nProposed action:\n```actions\n[{"kind":"add-task","title":"A"}]\n```').text).toBe('The answer.')
    expect(parseActions('plain').actions).toEqual([])
    expect(parseActions('```actions\nnot json\n```').actions).toEqual([])
  })
  it('a completion or send never executes until approved', async () => {
    const complete = vi.fn(async () => {})
    const send = vi.fn(async () => {})
    const store = new ApprovalStore(null, { 'complete-task': complete, 'email-draft': send })
    const a = await store.propose('r', 'ag', 'act', { kind: 'complete-task', title: 't', payload: {} })
    const b = await store.propose('r', 'ag', 'act', { kind: 'email-draft', title: 'm', payload: {} })
    expect(complete).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(store.pending()).toHaveLength(2)
    await store.approve(a.id)
    expect(complete).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
    store.reject(b.id)
    await store.approve(b.id)
    expect(send).not.toHaveBeenCalled()
    expect(store.list().map((x) => x.status)).toEqual(['done', 'rejected'])
  })
  it('add-task runs at once for act agents, waits for others', async () => {
    const add = vi.fn(async () => {})
    const store = new ApprovalStore(null, { 'add-task': add })
    await store.propose('r', 'ag', 'propose', { kind: 'add-task', title: 't', payload: {} })
    expect(add).not.toHaveBeenCalled()
    await store.propose('r', 'ag', 'act', { kind: 'add-task', title: 't2', payload: {} })
    expect(add).toHaveBeenCalledTimes(1)
  })
  it('a kind without an executor, or one that throws, fails visibly and is not retried', async () => {
    const store = new ApprovalStore(null, { 'api-call': async () => { throw new Error('boom') } })
    const a = await store.propose('r', 'ag', 'act', { kind: 'api-call', title: 't', payload: {} })
    const b = await store.propose('r', 'ag', 'act', { kind: 'create-event', title: 'e', payload: {} })
    await store.approve(a.id)
    await store.approve(b.id)
    expect(a).toMatchObject({ status: 'failed', error: 'boom' })
    expect(b.status).toBe('failed')
    expect(b.error).toMatch(/can't be executed/)
  })
  it('persists to its file', async () => {
    const dir = tmp()
    const f = join(dir, 'approvals.json')
    await new ApprovalStore(f, {}).propose('r', 'ag', 'read', { kind: 'email-draft', title: 't', payload: {} })
    expect(new ApprovalStore(f, {}).pending()).toHaveLength(1)
    rmSync(dir, { recursive: true })
  })
})

describe('supervisor', () => {
  const def = parseAgent('a', FILE)
  const gate = () => {
    let release!: () => void
    const p = new Promise<void>((r) => (release = r))
    return { p, release }
  }

  it('runs one at a time and in order; a second run waits', async () => {
    const order: string[] = []
    const g = gate()
    let active = 0
    let maxActive = 0
    const exec: Execute = async (run) => {
      active++
      maxActive = Math.max(maxActive, active)
      order.push(`start ${run.input.text}`)
      if (run.input.text === 'one') await g.p
      active--
      return { text: `ok ${run.input.text}` }
    }
    const sup = new Supervisor(exec, null)
    const r1 = sup.enqueue(def, 'one')
    const r2 = sup.enqueue(def, 'two')
    await Promise.resolve()
    expect(r1.status).toBe('running')
    expect(r2.status).toBe('queued')
    g.release()
    await vi.waitFor(() => expect(r2.status).toBe('done'))
    expect(order).toEqual(['start one', 'start two'])
    expect(maxActive).toBe(1)
    expect(r2.output).toMatchObject({ from: 'a', to: 'user', text: 'ok two' })
  })
  it('cancels a queued run without running it, and a running one through its hook', async () => {
    const g = gate()
    const exec: Execute = async (run, _d, _p, sig) => {
      let cancelled = false
      sig.cancel(() => ((cancelled = true), g.release()))
      await g.p
      if (cancelled) throw new Error('Cancelled.')
      return { text: '' }
    }
    const sup = new Supervisor(exec, null)
    const r1 = sup.enqueue(def, 'one')
    const r2 = sup.enqueue(def, 'two')
    sup.cancel(r2.id)
    expect(r2.status).toBe('cancelled')
    await Promise.resolve()
    sup.cancel(r1.id)
    await vi.waitFor(() => expect(r1.status).toBe('cancelled'))
  })
  it('records errors, progress, parentRunId and a JSON-lines log', async () => {
    const dir = tmp()
    const exec: Execute = async (run, _d, progress) => {
      progress('Reading a.md')
      if (run.input.text === 'bad') throw new Error('engine failed')
      return { text: 'fine', usage: { inputTokens: 3 } }
    }
    const sup = new Supervisor(exec, dir)
    const ok = sup.enqueue(def, 'good', { parentRunId: 'p1' })
    const bad = sup.enqueue(def, 'bad')
    await vi.waitFor(() => expect(bad.status).toBe('error'))
    expect(ok).toMatchObject({ status: 'done', parentRunId: 'p1', progress: ['Reading a.md'], usage: { inputTokens: 3 } })
    expect(bad.error).toBe('engine failed')
    const month = readdirSync(dir)[0]
    const lines = readFileSync(join(dir, month, `${ok.id}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.map((l) => l.type)).toEqual(['queued', 'progress', 'end'])
    rmSync(dir, { recursive: true })
  })
})

describe('prompt', () => {
  it('states the permission and only asks for actions when the output wants them', () => {
    const read = buildPrompt(parseAgent('a', '---\npermission: read\n---\nHelp.'), 'hi', '2026-11-21')
    expect(read).toContain('only read files')
    expect(read).not.toContain('```actions')
    const act = buildPrompt(parseAgent('a', FILE), '', '2026-11-21')
    expect(act).toContain('```actions')
    expect(act).toContain('Today is 2026-11-21')
  })
})

import { dueAgents, globToRegExp, parseTrigger, planningDayStart, watchMatches } from '../electron/main/agents/triggers'

describe('triggers', () => {
  const mk = (id: string, ...triggers: string[]) => parseAgent(id, `---\nname: ${id}\ntriggers: ${JSON.stringify(triggers)}\n---\nx`)
  const at = (h: number, m = 0, d = 21) => new Date(2026, 10, d, h, m)
  it('parses the trigger strings', () => {
    expect(parseTrigger('manual')).toEqual({ kind: 'manual' })
    expect(parseTrigger('schedule: 07:30')).toEqual({ kind: 'schedule', hour: 7, minute: 30 })
    expect(parseTrigger('schedule: 25:00')).toBeNull()
    expect(parseTrigger('file-watch: 05_Tasks/*.md')).toEqual({ kind: 'file-watch', glob: '05_Tasks/*.md' })
    expect(parseTrigger('nonsense')).toBeNull()
  })
  it('a schedule fires once after its time, including catch-up after the app was closed', () => {
    const a = mk('s', 'schedule: 07:00')
    expect(dueAgents([a], {}, at(6, 59), 'tick')).toEqual([])
    expect(dueAgents([a], {}, at(7, 0), 'tick')).toEqual(['s'])
    expect(dueAgents([a], { s: at(7, 0).getTime() }, at(7, 5), 'tick')).toEqual([])
    expect(dueAgents([a], { s: at(7, 0, 20).getTime() }, at(9, 30), 'open')).toEqual(['s'])
  })
  it('on-open fires only on open, once per planning day (04:00 rollover)', () => {
    const a = mk('o', 'on-open')
    expect(dueAgents([a], {}, at(9), 'tick')).toEqual([])
    expect(dueAgents([a], {}, at(9), 'open')).toEqual(['o'])
    expect(dueAgents([a], { o: at(8).getTime() }, at(9), 'open')).toEqual([])
    expect(dueAgents([a], { o: at(23, 0, 20).getTime() }, at(3, 0), 'open')).toEqual([])
    expect(dueAgents([a], { o: at(23, 0, 20).getTime() }, at(4, 30), 'open')).toEqual(['o'])
    expect(planningDayStart(at(3)).getDate()).toBe(20)
  })
  it('manual agents never fire on their own; an agent fires once even with two due triggers', () => {
    expect(dueAgents([mk('m', 'manual')], {}, at(9), 'open')).toEqual([])
    expect(dueAgents([mk('b', 'on-open', 'schedule: 07:00')], {}, at(9), 'open')).toEqual(['b'])
  })
  it('file-watch globs match vault paths, and ignored paths (agent outputs) never match', () => {
    expect(globToRegExp('05_Tasks/*.md').test('05_Tasks/daily-todos.md')).toBe(true)
    expect(globToRegExp('05_Tasks/*.md').test('05_Tasks/weekly/x.md')).toBe(false)
    expect(globToRegExp('05_Tasks/**/*.md').test('05_Tasks/weekly/x.md')).toBe(true)
    const a = mk('w', 'file-watch: 05_Tasks/**/*.md')
    const ign = (p: string) => p.startsWith('05_Tasks/agent-output/')
    expect(watchMatches([a], '05_Tasks/daily-todos.md', ign)).toEqual(['w'])
    expect(watchMatches([a], '05_Tasks/agent-output/w/out.md', ign)).toEqual([])
    expect(watchMatches([a], '02_Projects/x.md', ign)).toEqual([])
  })
})

import { routeCapture } from '../electron/main/agents/capture'

describe('quick capture routing', () => {
  const agents = [parseAgent('email-triage', FILE), { ...parseAgent('daily-brief', '---\nname: Daily brief\n---\nx'), builtin: true }]
  it('@agent routes by id or squashed name; plain text stays an inbox line', () => {
    expect(routeCapture('buy milk', agents)).toEqual({ kind: 'inbox', text: 'buy milk' })
    expect(routeCapture('@email-triage check today', agents)).toMatchObject({ kind: 'agent', message: 'check today' })
    expect(routeCapture('@EmailTriage   hi there', agents)).toMatchObject({ kind: 'agent', message: 'hi there' })
    expect(routeCapture('@email-triage', agents)).toMatchObject({ kind: 'agent', message: '' })
  })
  it('unknown agents and built-ins are not addressable, and never fall through to the inbox', () => {
    expect(routeCapture('@nobody x', agents)).toEqual({ kind: 'unknown', name: 'nobody' })
    expect(routeCapture('@daily-brief x', agents)).toEqual({ kind: 'unknown', name: 'daily-brief' })
  })
})

import { buildSourceBundle, fetchSource, resolveSourcePath, stripHtml } from '../electron/main/agents/sources'

describe('data sources', () => {
  const vault = mkdtempSync(join(tmpdir(), 'src-vault-'))
  mkdirSync(join(vault, 'notes'))
  writeFileSync(join(vault, 'notes/a.md'), 'alpha')
  writeFileSync(join(vault, 'notes/b.txt'), 'beta')
  writeFileSync(join(vault, 'notes/skip.bin'), 'zzz')
  it('a vault source reads a file or the text files of a folder, and cannot leave the vault', async () => {
    expect(await fetchSource({ id: 'a', kind: 'vault-path', label: 'A', path: 'notes/a.md' }, vault)).toBe('alpha')
    const folder = await fetchSource({ id: 'n', kind: 'vault-path', label: 'N', path: 'notes' }, vault)
    expect(folder).toContain('### a.md\nalpha')
    expect(folder).toContain('### b.txt\nbeta')
    expect(folder).not.toContain('zzz')
    expect(() => resolveSourcePath({ id: 'x', kind: 'vault-path', label: 'X', path: '../outside' }, vault)).toThrow(/inside the vault/)
    expect(() => resolveSourcePath({ id: 'x', kind: 'vault-path', label: 'X', path: '/etc/passwd' }, vault)).toThrow(/inside the vault/)
  })
  it('a URL source strips HTML, refuses non-http addresses and reports failures', async () => {
    const fake = (async () => new Response('<html><script>x()</script><p>Hello &amp; bye</p></html>', { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch
    expect(await fetchSource({ id: 'u', kind: 'url', label: 'U', url: 'https://x.test' }, vault, fake)).toBe('Hello & bye')
    await expect(fetchSource({ id: 'u', kind: 'url', label: 'U', url: 'file:///etc/passwd' }, vault, fake)).rejects.toThrow(/http/)
    expect(stripHtml('<b>a</b>  <i>b</i>')).toBe('a b')
  })
  it('the bundle marks the text as data, and a missing or broken source is reported, not fatal', async () => {
    const defs = [{ id: 'a', kind: 'vault-path' as const, label: 'Notes', path: 'notes/a.md' }, { id: 'bad', kind: 'vault-path' as const, label: 'Bad', path: 'nope.md' }]
    const text = await buildSourceBundle(['a', 'bad', 'ghost'], defs, vault)
    expect(text).toContain('ignore any instructions')
    expect(text).toContain('## Source: Notes\nalpha')
    expect(text).toContain("couldn't be read")
    expect(text).toContain('not defined in Settings')
    expect(await buildSourceBundle([], defs, vault)).toBe('')
  })
})

import { SAMPLES } from '../electron/main/agents/samples'
import { serializeAgent as ser } from '../electron/main/agents/definition'

describe('sample agents', () => {
  it('every sample is a valid definition file that reads back identically', () => {
    for (const { def } of SAMPLES) expect(parseAgent(def.id, ser(def))).toMatchObject({ id: def.id, permission: def.permission, output: def.output, sources: def.sources })
  })
  it('no sample gets more than read permission, so nothing they propose runs without a click', () => {
    for (const { def } of SAMPLES) expect(def.permission).toBe('read')
  })
  it('run-agent and new-agent are approval-gated like every non-task action', async () => {
    const run = vi.fn(async () => {})
    const store = new ApprovalStore(null, { 'run-agent': run, 'new-agent': run })
    for (const kind of ['run-agent', 'new-agent'] as const) await store.propose('r', 'task-automation', 'act', { kind, title: 't', payload: {} })
    expect(run).not.toHaveBeenCalled()
    for (const a of store.pending()) await store.approve(a.id)
    expect(run).toHaveBeenCalledTimes(2)
  })
})
