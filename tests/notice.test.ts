import { describe, expect, it } from 'vitest'
import { notice, shouldNotify } from '../electron/main/agents/notice'
import { Supervisor } from '../electron/main/agents/supervisor'
import { parseAgent } from '../electron/main/agents/definition'

describe('agent notifications', () => {
  it('shows only in the background and unless switched off', () => {
    expect(shouldNotify(undefined, false)).toBe(true)
    expect(shouldNotify(true, false)).toBe(true)
    expect(shouldNotify(false, false)).toBe(false)
    expect(shouldNotify(true, true)).toBe(false)
  })
  it('says what happened without the answer text and keeps it short', () => {
    expect(notice('failed', 'Scout', 'It broke\n badly')).toEqual({ title: 'Scout failed', body: 'It broke badly' })
    expect(notice('approval', 'Scout').title).toBe('Scout wants your OK')
    expect(notice('goal', 'Coordinator', 'done: plan the week')).toEqual({ title: 'Goal update', body: 'Coordinator: done: plan the week' })
    expect(notice('failed', 'S', 'x'.repeat(500)).body).toHaveLength(120)
  })
  it('the supervisor reports a failed run, not a cancelled one', async () => {
    const seen: string[] = []
    const sup = new Supervisor(async (run) => { if (run.input.text === 'bad') throw new Error('boom'); return { text: 'ok' } }, null, () => {}, undefined, null, (kind, run) => seen.push(`${kind}:${run.agentId}`))
    const def = parseAgent('scout', '---\nname: Scout\n---\nx')
    await sup.wait(sup.enqueue(def, 'bad').id)
    await sup.wait(sup.enqueue(def, 'fine').id)
    expect(seen).toEqual(['failed:scout'])
  })
})

import { claudeCli } from '../electron/main/agents/engines/claude-cli'

describe('streamed answers', () => {
  it('claude assistant text blocks become text events, tools stay tool events', () => {
    const out = claudeCli.parse({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looking…' }, { type: 'tool_use', name: 'Read', input: { file_path: '/a.md' } }] } })
    expect(out).toEqual([{ type: 'text', text: 'Looking…' }, { type: 'tool', name: 'Read', target: '/a.md' }])
  })
  it('the supervisor keeps the answer so far on the run and clears it when the run ends', async () => {
    let seen = ''
    const sup = new Supervisor(async (run, _d, _p, sig) => { sig.text('half an ans'); seen = run.partial ?? ''; return { text: 'half an answer' } }, null)
    const r = sup.enqueue(parseAgent('scout', '---\nname: Scout\n---\nx'), 'q')
    await sup.wait(r.id)
    expect(seen).toBe('half an ans')
    expect(r.partial).toBeUndefined()
    expect(r.output?.text).toBe('half an answer')
  })
})
