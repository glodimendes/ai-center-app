import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseInbox, parseTasks } from '../electron/main/vault/parser'
import { addInboxItem, deleteTask, insertTask, patchTask } from '../electron/main/vault/edits'
import { editTokens, inferYear, parseTokens } from '../electron/main/vault/tokens'
import { DEFAULT_PREFERENCES, parsePreferences, serializePreferences } from '../electron/main/vault/preferences'
import { parseWeekly, serializeWeekly } from '../electron/main/vault/weekly'

const today = new Date(2026, 10, 8)
const cats = DEFAULT_PREFERENCES.categories
const todos = readFileSync(join(__dirname, 'fixtures/daily-todos.md'), 'utf8')
const inbox = readFileSync(join(__dirname, 'fixtures/braindump-inbox.md'), 'utf8')
const FILE = '05_Tasks/daily-todos.md'

const diffLines = (a: string, b: string) => {
  const x = a.split('\n')
  const y = b.split('\n')
  return x.map((l, i) => (l !== y[i] ? i : -1)).filter((i) => i >= 0)
}

describe('tokens', () => {
  it('parses the existing deadline styles', () => {
    expect(parseTokens('Implement load.py by 31/10', today)).toMatchObject({ title: 'Implement load.py', due: '2026-10-31', dueStyle: 'by-slash' })
    expect(parseTokens('Fazer o cadastro da Data Annotation by 05.11', today)).toMatchObject({ due: '2026-11-05', dueStyle: 'by-dot' })
    expect(parseTokens('Email pro Swissnext - by 30.10', today)).toMatchObject({ title: 'Email pro Swissnext', due: '2026-10-30' })
    expect(parseTokens('Anotar paper 1 by 01/09', today).due).toBe('2026-09-01')
  })

  it('parses estimate, iso due and priority', () => {
    expect(parseTokens('Apply to UBS ~1h30m due:2026-11-15 !high', today)).toEqual({
      title: 'Apply to UBS', estimateMin: 90, due: '2026-11-15', dueStyle: 'iso', priority: 'high'
    })
    expect(parseTokens('Read ~45m', today).estimateMin).toBe(45)
    expect(parseTokens('Read ~1.5h', today).estimateMin).toBe(90)
    expect(parseTokens('Write chapter ~8h @spread', today)).toMatchObject({ title: 'Write chapter', timing: 'spread' })
    expect(editTokens('Write chapter ~8h', { timing: 'spread' }, today)).toBe('Write chapter ~8h @spread')
    expect(editTokens('Write chapter ~8h @spread', { timing: null }, today)).toBe('Write chapter ~8h')
  })

  it('infers the nearest year', () => {
    expect(inferYear(15, 1, today)).toBe(2027)
    expect(inferYear(1, 9, today)).toBe(2026)
  })

  it('edits tokens in place and keeps the user style', () => {
    expect(editTokens('Implement load.py by 31/10', { due: '2026-11-12' }, today)).toBe('Implement load.py by 12/11')
    expect(editTokens('Do thing', { estimateMin: 120 }, today)).toBe('Do thing ~2h')
    expect(editTokens('Do thing ~2h !high', { estimateMin: 45, priority: 'medium' }, today)).toBe('Do thing ~45m')
    expect(editTokens('Do thing ~2h', { estimateMin: null }, today)).toBe('Do thing')
  })
})

describe('parseTasks on the real daily-todos.md', () => {
  const { tasks, sections } = parseTasks(todos, FILE, cats, today)

  it('maps headings to categories', () => {
    const t = tasks.find((t) => t.title.startsWith('Implement `load.py`'))!
    expect(t.section).toEqual(['ETH', 'Thesis'])
    expect(t.category).toBe('thesis')
    expect(tasks.find((t) => t.title.startsWith('Revisar matemática dos métodos'))!.category).toBe('courses')
    expect(tasks.find((t) => t.title.startsWith('Apply to Apple'))!.category).toBe('outside')
    expect(tasks.find((t) => t.title.startsWith('schedule dermathologist'))!.category).toBe('personal')
    expect(tasks.find((t) => t.title.startsWith('Revisar a documentação disponível'))!.category).toBe('outside')
    expect(sections.some((s) => s.path.join('>') === 'ETH>Thesis')).toBe(true)
  })

  it('nests subtasks', () => {
    const parent = tasks.find((t) => t.title.includes('Train for general coding interviews'))!
    expect(parent.childIds).toHaveLength(2)
    const child = tasks.find((t) => t.id === parent.childIds[0])!
    expect(child.parentId).toBe(parent.id)
  })

  it('gives unique stable ids', () => {
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length)
    const again = parseTasks('\n\n' + todos, FILE, cats, today).tasks
    expect(again.map((t) => t.id)).toEqual(tasks.map((t) => t.id))
  })
})

describe('edits are line-local', () => {
  const { tasks } = parseTasks(todos, FILE, cats, today)
  const target = tasks.find((t) => t.title.startsWith('Treinar SQL'))!

  it('toggling done changes exactly one line', () => {
    const out = patchTask(todos, FILE, target.id, { done: true }, cats, today)
    expect(diffLines(todos, out)).toEqual([target.line])
    expect(out.split('\n')[target.line]).toBe('- [x] Treinar SQL')
  })

  it('adding an estimate changes exactly one line', () => {
    const out = patchTask(todos, FILE, target.id, { estimateMin: 60 }, cats, today)
    expect(diffLines(todos, out)).toEqual([target.line])
    expect(out.split('\n')[target.line]).toBe('- [ ] Treinar SQL ~1h')
  })

  it('finds the task after unrelated lines shift', () => {
    const shifted = 'NEW LINE\n' + todos
    const out = patchTask(shifted, FILE, target.id, { done: true }, cats, today)
    expect(diffLines(shifted, out)).toEqual([target.line + 1])
  })

  it('inserts into a section after its last item', () => {
    const out = insertTask(todos, ['ETH', 'DMS'], 'Watch lecture 8 ~1h')
    const lines = out.split('\n')
    const idx = lines.indexOf('- [ ] Watch lecture 8 ~1h')
    expect(lines[idx - 1]).toContain('Treinar SQL')
    expect(out.split('\n').length).toBe(todos.split('\n').length + 1)
  })

  it('deletes a task with its children', () => {
    const parent = tasks.find((t) => t.title.includes('Train for general coding interviews'))!
    const out = deleteTask(todos, FILE, parent.id, cats, today)
    expect(out.split('\n').length).toBe(todos.split('\n').length - 3)
  })
})

describe('inbox', () => {
  it('parses dated items and ignores routing notes', () => {
    const items = parseInbox(inbox, '05_Tasks/braindump-inbox.md')
    expect(items.map((i) => i.text)).toContain('Cybathlon.')
    expect(items.some((i) => i.text.includes('Portfolio and internship ideas'))).toBe(false)
  })

  it('adds a new dated section before routing notes', () => {
    const out = addInboxItem(inbox, 'Look into Hyrox Zurich', today)
    const items = parseInbox(out, 'x')
    expect(items.find((i) => i.text === 'Look into Hyrox Zurich')?.date).toBe('2026-11-08')
    expect(out.indexOf('## 2026-11-08')).toBeLessThan(out.indexOf('## Routing Notes'))
  })
})

describe('preferences', () => {
  it('round-trips through the frontmatter', () => {
    const text = serializePreferences(DEFAULT_PREFERENCES)
    expect(parsePreferences(text)).toEqual(DEFAULT_PREFERENCES)
  })
})

describe('weekly file', () => {
  const pin = { blockId: 'pin:a', category: 'thesis', title: 'Thesis', start: '2026-11-09T09:00:00', end: '2026-11-09T10:00:00', taskIds: ['t1'] }

  it('round-trips manual overrides', () => {
    const data = {
      week: '2026-W46',
      log: [],
      pins: [pin],
      overrides: { dismissed: ['2026-11-09:thesis:1'], assignments: [{ blockId: 'evt:x', taskIds: ['t1', 't2'] }], exclusions: [{ blockId: 'evt:x', taskId: 't3' }] }
    }
    expect(parseWeekly(serializeWeekly(data, cats), '2026-W46')).toEqual(data)
  })

  it('omits empty overrides and reads files written before them', () => {
    const text = serializeWeekly({ week: '2026-W46', log: [], pins: [pin], overrides: { dismissed: [], assignments: [{ blockId: 'evt:x', taskIds: [] }] } }, cats)
    expect(text).not.toContain('overrides')
    expect(parseWeekly(text, '2026-W46')).toEqual({ week: '2026-W46', log: [], pins: [pin] })
  })
})
