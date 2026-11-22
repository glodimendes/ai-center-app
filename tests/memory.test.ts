import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendMemory, MEMORY_CHARS, notesForPrompt, PROMPT_CHARS, readMemory, removeMemory, removeNote, trimNotes, writeMemory } from '../electron/main/agents/memory'
import { parseAgent, serializeAgent } from '../electron/main/agents/definition'
import { canAutoRun } from '../electron/main/agents/permissions'
import { ADAPT_FORMAT, buildPrompt } from '../electron/main/agents/runner'
import { ApprovalStore, parseActions } from '../electron/main/agents/actions'

const dir = () => mkdtempSync(join(tmpdir(), 'memory-'))
const agent = (extra = '') => parseAgent('scout', `---\nname: Scout\n${extra}---\nDo it.`)

describe('agent memory', () => {
  it('is an opt-in flag that survives the file round trip', () => {
    expect(agent().memory).toBeUndefined()
    const d = agent('memory: true\n')
    expect(d.memory).toBe(true)
    expect(parseAgent('scout', serializeAgent(d)).memory).toBe(true)
  })
  it('appends dated lines, reads them back and deletes with the agent', () => {
    const d = dir()
    expect(readMemory(d, 'scout')).toBe('')
    appendMemory(d, 'scout', 'Prefers   short\nanswers', '2026-11-22')
    appendMemory(d, 'scout', 'Works on Fridays', '2026-11-23')
    expect(readMemory(d, 'scout')).toBe('- 2026-11-22: Prefers short answers\n- 2026-11-23: Works on Fridays\n')
    expect(() => appendMemory(d, 'scout', '  ', '2026-11-24')).toThrow()
    removeMemory(d, 'scout')
    expect(readMemory(d, 'scout')).toBe('')
  })
  it('drops the oldest lines to stay within the limits', () => {
    expect(trimNotes('a\nb\nc', 3)).toBe('b\nc')
    const long = Array.from({ length: 400 }, (_, i) => `- note ${i} ${'x'.repeat(40)}`).join('\n')
    const d = dir()
    writeMemory(d, 'scout', long)
    expect(readMemory(d, 'scout').length).toBeLessThanOrEqual(MEMORY_CHARS + 1)
    expect(readMemory(d, 'scout')).toContain('note 399')
    expect(notesForPrompt(long).length).toBeLessThanOrEqual(PROMPT_CHARS)
  })
  it('shows its notes and the note format to a memory agent only', () => {
    const on = buildPrompt(agent('memory: true\n'), '', '2026-11-22', '', false, '', undefined, '- 2026-11-22: likes tables')
    expect(on).toContain('Your notes from earlier runs')
    expect(on).toContain('likes tables')
    expect(on).toContain('"kind": "remember"')
    const off = buildPrompt(agent(), '', '2026-11-22', '', false, '', undefined, '- note')
    expect(off).not.toContain('Your notes')
    expect(off).not.toContain('remember')
    expect(buildPrompt(agent('memory: true\n'), 'hi', '2026-11-22', '', true, '', undefined, '- note')).toBe('hi')
  })
  it('remember is a known action kept at once for any permission; changing instructions always needs a click', () => {
    const text = 'ok\n```actions\n[{"kind":"remember","title":"Note","payload":{"note":"x"}},{"kind":"update-instructions","title":"Bullets","payload":{"instructions":"Use bullets."}}]\n```'
    expect(parseActions(text).actions.map((a) => a.kind)).toEqual(['remember', 'update-instructions'])
    for (const p of ['read', 'propose', 'act'] as const) {
      expect(canAutoRun('remember', p)).toBe(true)
      expect(canAutoRun('update-instructions', p)).toBe(false)
    }
    expect(canAutoRun('add-task', 'propose')).toBe(false)
    expect(canAutoRun('add-task', 'act')).toBe(true)
  })
  it('undoing a kept note removes that line only, and the newest match when it was noted twice', () => {
    const d = dir()
    appendMemory(d, 'scout', 'Likes tables', '2026-11-20')
    appendMemory(d, 'scout', 'Writes in German', '2026-11-21')
    appendMemory(d, 'scout', 'Likes   tables', '2026-11-22')
    removeNote(d, 'scout', 'Likes tables')
    expect(readMemory(d, 'scout')).toBe('- 2026-11-20: Likes tables\n- 2026-11-21: Writes in German\n')
    removeNote(d, 'scout', 'not there')
    removeNote(d, 'scout', '')
    expect(readMemory(d, 'scout').split('\n').filter(Boolean)).toHaveLength(2)
  })
  it('the store takes back only a kept note, and only once', async () => {
    const store = new ApprovalStore(null, { remember: async () => {} })
    const note = await store.propose('r1', 'scout', 'read', { kind: 'remember', title: 'n', payload: { note: 'x' } })
    expect(note.status).toBe('done')
    let undone = 0
    await store.undo(note.id, () => void undone++)
    await store.undo(note.id, () => void undone++)
    expect(undone).toBe(1)
    expect(note.status).toBe('rejected')
    const change = await store.propose('r1', 'scout', 'act', { kind: 'update-instructions', title: 'c', payload: { instructions: 'x' } })
    expect(change.status).toBe('pending')
    await store.undo(change.id, () => void undone++)
    expect(undone).toBe(1)
  })
  it('chat prompts can offer the instruction change; it is explicit that the user applies it', () => {
    expect(ADAPT_FORMAT).toContain('"kind": "update-instructions"')
    expect(ADAPT_FORMAT).toContain('only if the user clicks Apply')
  })
})
