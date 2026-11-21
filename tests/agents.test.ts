import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
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
