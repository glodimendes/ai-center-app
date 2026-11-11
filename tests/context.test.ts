import { describe, expect, it } from 'vitest'
import { diffHunks, revertEdits } from '../electron/main/context/revert'

const doc = (...lines: string[]) => lines.join('\n') + '\n'

describe('revertEdits (Update context undo)', () => {
  const before = doc('# Priorities', '', '- Thesis', '- Courses', '', 'Last updated: 2026-11-01')
  const after = doc('# Priorities', '', '- Thesis', '- Courses', '- BRASA webinar', '', 'Last updated: 2026-11-11')

  it('restores the file when nothing else changed it', () => {
    expect(revertEdits(before, after, after)).toBe(before)
  })

  it('keeps edits made elsewhere in the file after the run', () => {
    const current = after.replace('# Priorities', '# Priorities (HS26)')
    expect(revertEdits(before, after, current)).toBe(before.replace('# Priorities', '# Priorities (HS26)'))
  })

  it('keeps lines added after the run next to the agent edit', () => {
    const current = after.replace('- BRASA webinar\n', '- BRASA webinar\n- Mentoring\n')
    expect(revertEdits(before, after, current)).toBe(before.replace('- Courses\n', '- Courses\n- Mentoring\n'))
  })

  it('gives up when the agent line itself was edited since', () => {
    const current = after.replace('- BRASA webinar', '- BRASA webinar (moved to Friday)')
    expect(revertEdits(before, after, current)).toBeNull()
  })

  it('gives up when the agent edit can no longer be placed unambiguously', () => {
    const b = doc('top', 'a', 'x', 'b', 'end')
    const a = doc('top', 'a', 'y', 'b', 'end')
    expect(revertEdits(b, a, doc('a', 'y', 'b', 'a', 'y', 'b'))).toBeNull()
  })

  it('handles edits at the start and end of a file', () => {
    const b = doc('one', 'two', 'three')
    const a = doc('zero', 'one', 'two', 'three', 'four')
    const current = doc('zero', 'one', 'two!', 'three', 'four')
    expect(revertEdits(b, a, current)).toBe(doc('one', 'two!', 'three'))
  })
})

describe('diffHunks', () => {
  it('finds each changed stretch', () => {
    expect(diffHunks(['a', 'b', 'c', 'd'], ['a', 'B', 'c', 'd', 'e'])).toEqual([
      { start: 1, end: 2, lines: ['B'] },
      { start: 4, end: 4, lines: ['e'] }
    ])
  })
})
