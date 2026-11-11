import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseInbox, parseTasks } from '../electron/main/vault/parser'
import { addInboxItem, addSubtask, deleteTask, indentTask, insertTask, patchTask, reorderTask, takeDone } from '../electron/main/vault/edits'
import { editTokens, inferYear, parseTokens } from '../electron/main/vault/tokens'
import { DEFAULT_PREFERENCES, parsePreferences, serializePreferences } from '../electron/main/vault/preferences'
import { parseWeekly, serializeWeekly } from '../electron/main/vault/weekly'
import { describeRepeat, earliestFor, nextOccurrence, parseRepeat } from '../shared/repeat'

const today = new Date(2026, 10, 8)
const cats = DEFAULT_PREFERENCES.categories
// Synthetic samples (committed) with the real files' shape. Copies of the real files, if present in
// tests/fixtures/ (gitignored), get the same structural checks below.
const todos = readFileSync(join(__dirname, 'sample/daily-todos.md'), 'utf8')
const inbox = readFileSync(join(__dirname, 'sample/braindump-inbox.md'), 'utf8')
const realTodos = join(__dirname, 'fixtures/daily-todos.md')
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
    expect(parseTokens('Submit form !urgent', today)).toEqual({ title: 'Submit form', priority: 'urgent' })
    expect(editTokens('Do thing ~2h !high', { priority: 'urgent' }, today)).toBe('Do thing ~2h !urgent')
    expect(editTokens('Do thing ~2h !urgent', { priority: 'low' }, today)).toBe('Do thing ~2h !low')
  })
})

describe('parseTasks on a daily-todos.md', () => {
  const { tasks, sections } = parseTasks(todos, FILE, cats, today)

  it('maps headings to categories', () => {
    const t = tasks.find((t) => t.title.startsWith('Implement `parser.py`'))!
    expect(t.section).toEqual(['ETH', 'Thesis'])
    expect(t.category).toBe('thesis')
    expect(t.due).toBe('2026-10-31')
    expect(tasks.find((t) => t.title.startsWith('Revisar matemática do método'))!.category).toBe('courses')
    expect(tasks.find((t) => t.title.startsWith('Apply to Example Corp'))!.category).toBe('outside')
    expect(tasks.find((t) => t.title.startsWith('schedule dentist'))!.category).toBe('personal')
    expect(tasks.find((t) => t.title.startsWith('Revisar a documentação do projeto'))!.category).toBe('outside')
    expect(sections.some((s) => s.path.join('>') === 'ETH>Thesis')).toBe(true)
  })

  it('nests subtasks', () => {
    const parent = tasks.find((t) => t.title.includes('Train for coding interviews'))!
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

describe.skipIf(!existsSync(realTodos))('the real daily-todos.md copy (local only)', () => {
  const real = existsSync(realTodos) ? readFileSync(realTodos, 'utf8') : ''
  const { tasks } = parseTasks(real, FILE, cats, today)

  it('parses with unique ids that survive shifted lines', () => {
    expect(tasks.length).toBeGreaterThan(0)
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length)
    expect(parseTasks('\n\n' + real, FILE, cats, today).tasks.map((t) => t.id)).toEqual(tasks.map((t) => t.id))
  })

  it('checking off any open task changes exactly its own line', () => {
    for (const t of tasks.filter((x) => !x.done)) expect(diffLines(real, patchTask(real, FILE, t.id, { done: true }, cats, today))).toEqual([t.line])
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
    const parent = tasks.find((t) => t.title.includes('Train for coding interviews'))!
    const out = deleteTask(todos, FILE, parent.id, cats, today)
    expect(out.split('\n').length).toBe(todos.split('\n').length - 3)
  })
})

describe('subtasks', () => {
  const md = ['# Todos', '', '## ETH', '', '### Thesis', '- [ ] A', '- [ ] B ~1h', '\t- [ ] B1', '- [ ] C', '', '## Other', '- [ ] D', ''].join('\n')
  const parse = (t: string) => parseTasks(t, FILE, cats, today).tasks
  const byTitle = (t: string, title: string) => parse(t).find((x) => x.title === title)!

  it('nests a task under the one above, with its own subtasks, keeping its id', () => {
    const b = byTitle(md, 'B')
    const out = indentTask(md, FILE, b.id, 'in', cats, today)
    expect(out.split('\n').slice(5, 9)).toEqual(['- [ ] A', '\t- [ ] B ~1h', '\t\t- [ ] B1', '- [ ] C'])
    expect(byTitle(out, 'B')).toMatchObject({ id: b.id, parentId: byTitle(out, 'A').id })
    expect(diffLines(md, out)).toEqual([6, 7])
  })

  it('un-nests after the parent subtree, so later siblings keep their parent', () => {
    const two = ['## ETH', '- [ ] P', '\t- [ ] X', '\t- [ ] Y', '- [ ] Q'].join('\n')
    const out = indentTask(two, FILE, byTitle(two, 'X').id, 'out', cats, today)
    expect(out.split('\n')).toEqual(['## ETH', '- [ ] P', '\t- [ ] Y', '- [ ] X', '- [ ] Q'])
    expect(byTitle(out, 'Y').parentId).toBe(byTitle(out, 'P').id)
  })

  it('refuses without a task above at the same level, or across sections', () => {
    expect(() => indentTask(md, FILE, byTitle(md, 'A').id, 'in', cats, today)).toThrow()
    expect(() => indentTask(md, FILE, byTitle(md, 'D').id, 'in', cats, today)).toThrow()
    expect(() => indentTask(md, FILE, byTitle(md, 'A').id, 'out', cats, today)).toThrow()
  })

  it('adds a subtask at the end of the existing ones, in the file\'s indentation', () => {
    const out = addSubtask(md, FILE, byTitle(md, 'B').id, 'B2 ~30m', cats, today)
    expect(out.split('\n').slice(6, 10)).toEqual(['- [ ] B ~1h', '\t- [ ] B1', '\t- [ ] B2 ~30m', '- [ ] C'])
    const out2 = addSubtask(md, FILE, byTitle(md, 'C').id, 'C1', cats, today)
    expect(byTitle(out2, 'C1').parentId).toBe(byTitle(out2, 'C').id)
  })
})

describe('reordering', () => {
  const md = ['# Todos', '', '## ETH', '', '### Thesis', '- [ ] A', '- [ ] B ~1h', '\t- [ ] B1', '- [ ] C', '', '## Other', '- [ ] D', ''].join('\n')
  const parse = (t: string) => parseTasks(t, FILE, cats, today).tasks
  const byTitle = (t: string, title: string) => parse(t).find((x) => x.title === title)!

  it('moves a task (with its subtasks) before a sibling', () => {
    const out = reorderTask(md, FILE, byTitle(md, 'C').id, byTitle(md, 'A').id, 'before', cats, today)
    expect(out.split('\n').slice(5, 9)).toEqual(['- [ ] C', '- [ ] A', '- [ ] B ~1h', '\t- [ ] B1'])
  })

  it('moves a task (with its subtasks) after a sibling', () => {
    const out = reorderTask(md, FILE, byTitle(md, 'A').id, byTitle(md, 'B').id, 'after', cats, today)
    expect(out.split('\n').slice(5, 9)).toEqual(['- [ ] B ~1h', '\t- [ ] B1', '- [ ] A', '- [ ] C'])
  })

  it('is a no-op when dropped on itself', () => {
    expect(reorderTask(md, FILE, byTitle(md, 'A').id, byTitle(md, 'A').id, 'after', cats, today)).toBe(md)
  })

  it('refuses across sections or levels', () => {
    expect(() => reorderTask(md, FILE, byTitle(md, 'A').id, byTitle(md, 'D').id, 'before', cats, today)).toThrow()
    expect(() => reorderTask(md, FILE, byTitle(md, 'A').id, byTitle(md, 'B1').id, 'before', cats, today)).toThrow()
  })
})

describe('takeDone (weekly review tidy)', () => {
  const md = ['## ETH', '### Thesis', '- [x] A', '- [ ] B', '\t- [x] B1', '\t- [ ] B2', '- [x] C', '\t- [x] C1', '- [x] D', '\t- [ ] D1', '', '## Other', '- [x] E', ''].join('\n')

  it('takes fully done subtrees, and done subtasks of open parents, and nothing else', () => {
    const { text, taken } = takeDone(md, FILE, cats, today)
    expect(text.split('\n')).toEqual(['## ETH', '### Thesis', '- [ ] B', '\t- [ ] B2', '- [x] D', '\t- [ ] D1', '', '## Other', ''])
    expect(taken).toEqual([
      { section: ['ETH', 'Thesis'], lines: ['- [x] A'] },
      { section: ['ETH', 'Thesis'], lines: ['- [x] B1'] },
      { section: ['ETH', 'Thesis'], lines: ['- [x] C', '\t- [x] C1'] },
      { section: ['Other'], lines: ['- [x] E'] }
    ])
  })

  it('leaves a file with nothing done untouched', () => {
    const open = md.replace(/\[x\]/g, '[ ]')
    expect(takeDone(open, FILE, cats, today)).toEqual({ text: open, taken: [] })
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

describe('repeating tasks', () => {
  const mon = new Date(2026, 10, 9) // Monday

  it('parses common and custom rules', () => {
    expect(parseRepeat('weekly')).toEqual({ every: 1, unit: 'w' })
    expect(parseRepeat('3d')).toEqual({ every: 3, unit: 'd' })
    expect(parseRepeat('thu,mon')).toEqual({ weekdays: [1, 4], weeks: 1 })
    expect(parseRepeat('3w:sun')).toEqual({ weekdays: [0], weeks: 3 })
    expect(describeRepeat('3w:sun')).toBe('Every 3 weeks on Sun')
    expect(parseRepeat('fortnightly')).toBeNull()
    expect(describeRepeat('2w')).toBe('Every 2 weeks')
    expect(describeRepeat('mon,thu')).toBe('Every Mon, Thu')
  })

  it('computes the next due date after today', () => {
    expect(nextOccurrence('weekly', '2026-11-09', mon)).toBe('2026-11-16')
    expect(nextOccurrence('daily', '2026-11-01', mon)).toBe('2026-11-10') // late: no overdue copy
    expect(nextOccurrence('monthly', '2026-10-31', mon)).toBe('2026-11-30') // month end clamps
    expect(nextOccurrence('mon,thu', '2026-11-09', mon)).toBe('2026-11-12')
    expect(nextOccurrence('weekdays', undefined, new Date(2026, 10, 13))).toBe('2026-11-16') // Fri → Mon
    expect(nextOccurrence('2w', '2026-11-20', mon)).toBe('2026-12-04') // done early: counts from the due date
    expect(nextOccurrence('3w:sun', '2026-11-08', mon)).toBe('2026-11-29')
    expect(nextOccurrence('3w:sun', '2026-10-18', mon)).toBe('2026-11-29') // late: keeps the 3-week rhythm
    expect(nextOccurrence('2w:tue,thu', '2026-11-10', mon)).toBe('2026-11-12') // same week: no skip
    expect(earliestFor('mon', '2026-11-16')).toBe('2026-11-16')
    expect(earliestFor('weekly', '2026-11-15')).toBe('2026-11-09')
  })

  it('reads and edits the repeat token', () => {
    expect(parseTokens('Weekly review ~30m repeat:weekly', mon)).toMatchObject({ title: 'Weekly review', estimateMin: 30, repeat: 'weekly' })
    expect(parseTokens('Pay repeat:soon', mon).repeat).toBeUndefined()
    expect(editTokens('Weekly review repeat:weekly', { repeat: '2w' }, mon)).toBe('Weekly review repeat:2w')
    expect(editTokens('Weekly review repeat:weekly', { repeat: null }, mon)).toBe('Weekly review')
  })

  it('checking one off adds the next occurrence above it, keeping the open task id', () => {
    const text = '## Personal\n\n- [ ] Water plants ~15m due:2026-11-09 repeat:3d\n- [ ] Other\n'
    const before = parseTasks(text, FILE, cats, mon).tasks[0]
    const out = patchTask(text, FILE, before.id, { done: true }, cats, mon)
    const lines = out.split('\n')
    expect(lines[2]).toBe('- [ ] Water plants ~15m due:2026-11-12 repeat:3d')
    expect(lines[3]).toBe('- [x] Water plants ~15m due:2026-11-09 repeat:3d')
    expect(lines[4]).toBe('- [ ] Other')
    const after = parseTasks(out, FILE, cats, mon).tasks
    expect(after.find((t) => t.id === before.id)).toMatchObject({ done: false, due: '2026-11-12' })
  })

  it('postpone: parsed, edited in place, and dropped from the next occurrence', () => {
    expect(parseTokens('Call bank postpone:2026-11-20 ~15m', mon)).toMatchObject({ title: 'Call bank', postponed: '2026-11-20', estimateMin: 15 })
    expect(editTokens('Call bank postpone:2026-11-20', { postponed: '2026-11-25' }, mon)).toBe('Call bank postpone:2026-11-25')
    expect(editTokens('Call bank postpone:2026-11-20', { postponed: null }, mon)).toBe('Call bank')
    const text = '## Personal\n\n- [ ] Review budget due:2026-11-09 repeat:weekly postpone:2026-11-09\n'
    const t = parseTasks(text, FILE, cats, mon).tasks[0]
    expect(patchTask(text, FILE, t.id, { done: true }, cats, mon).split('\n')[2]).toBe('- [ ] Review budget due:2026-11-16 repeat:weekly')
  })

  // Today's trash skips one occurrence instead of deleting the line (Controller.skipOccurrence).
  it('skipping one occurrence moves the due date on and keeps the series', () => {
    const text = '## Personal\n\n- [ ] Treino Push A due:2026-11-09 repeat:mon,thu\n- [ ] Other\n'
    const before = parseTasks(text, FILE, cats, mon).tasks[0]
    const next = nextOccurrence(before.repeat!, before.due, mon)!
    const out = patchTask(text, FILE, before.id, { due: next, postponed: null }, cats, mon)
    expect(out.split('\n')[2]).toBe('- [ ] Treino Push A due:2026-11-12 repeat:mon,thu')
    // Same number of lines: nothing deleted, no second copy of the task.
    expect(out.split('\n').length).toBe(text.split('\n').length)
    const after = parseTasks(out, FILE, cats, mon).tasks
    expect(after).toHaveLength(2)
    expect(after[0]).toMatchObject({ done: false, due: '2026-11-12', repeat: 'mon,thu' })
  })

  it('a skip is not a completion', () => {
    const text = '## Personal\n\n- [ ] Weekly review due:2026-11-09 repeat:weekly\n'
    const t = parseTasks(text, FILE, cats, mon).tasks[0]
    const out = patchTask(text, FILE, t.id, { due: '2026-11-16', postponed: null }, cats, mon)
    expect(out).not.toContain('[x]')
  })

  // Why Today must not call deleteTask on a repeating task: it takes the whole series with it.
  it('deleting a repeating task removes the series', () => {
    const text = '## Personal\n\n- [ ] Treino Push A due:2026-11-09 repeat:mon,thu\n- [ ] Other\n'
    const t = parseTasks(text, FILE, cats, mon).tasks[0]
    const out = deleteTask(text, FILE, t.id, cats, mon)
    expect(out).not.toContain('Treino Push A')
    expect(parseTasks(out, FILE, cats, mon).tasks).toHaveLength(1)
  })

  it('reopening a repeating task adds nothing', () => {
    const text = '## Personal\n\n- [x] Water plants repeat:daily\n'
    const t = parseTasks(text, FILE, cats, mon).tasks[0]
    expect(patchTask(text, FILE, t.id, { done: false }, cats, mon).split('\n').length).toBe(text.split('\n').length)
  })
})

describe('preferences migration', () => {
  it('folds an old single preferredWindow into preferredWindows', () => {
    const p = parsePreferences('---\ncategories:\n  - key: thesis\n    label: Thesis\n    headings: []\n    calendar: X\n    containers: []\n    defaultEstimateMinutes: 60\n    color: "#000"\n    preferredWindow: ["08:00", "12:00"]\n---\n')
    expect(p.categories[0].preferredWindows).toEqual([['08:00', '12:00']])
    expect(p.categories[0].preferredWindow).toBeUndefined()
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
