import { describe, expect, it } from 'vitest'
import { parseSegments } from '../src/lib/mdparse'

describe('markdown segments', () => {
  it('splits an answer without headings into top-level blocks and list items', () => {
    const segs = parseSegments('Intro line\n\n- first\n  - nested\n- second\n\n| a | b |\n|---|---|\n| 1 | 2 |')
    expect(segs.map((s) => s.source)).toEqual(['Intro line', '- first\n  - nested', '- second', '| a | b |\n|---|---|\n| 1 | 2 |'])
  })
  it('makes a heading and what follows it one section', () => {
    const segs = parseSegments('## Email\n- reply to A\n- reply to B\n\n## Research\nLook into X')
    expect(segs).toHaveLength(2)
    expect(segs[0].source).toBe('## Email\n- reply to A\n- reply to B')
    expect(segs[1].source).toBe('## Research\nLook into X')
  })
  it('nests items by indentation and reads checkboxes', () => {
    const [seg] = parseSegments('- [ ] top\n  - [x] child')
    const item = (seg.blocks[0] as any).item
    expect(item.check).toBe(false)
    expect(item.children[0].check).toBe(true)
  })
  it('keeps a code fence whole', () => {
    expect(parseSegments('```\n- not a list\n```')).toHaveLength(1)
  })
})
