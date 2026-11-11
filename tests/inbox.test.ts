import { describe, expect, it } from 'vitest'
import { addInboxItem, removeInboxItem } from '../electron/main/vault/edits'
import { parseInbox } from '../electron/main/vault/parser'

const FILE = '05_Tasks/braindump-inbox.md'
const base = '# Braindump\n\n## 2026-11-10\n\n- Look into Hyrox Zurich race dates\n\n## Routing Notes\n\n- Portfolio ideas go to projects.\n'

describe('inbox', () => {
  it('removing the last item under a date drops the empty heading too', () => {
    const added = addInboxItem(base, 'perf check', new Date(2026, 10, 11))
    const item = parseInbox(added, FILE).find((i) => i.text.includes('perf check'))!
    expect(removeInboxItem(added, FILE, item.id)).toBe(base)
  })

  it('keeps the heading while other items remain under it', () => {
    const two = base.replace('- Look into Hyrox Zurich race dates\n', '- Look into Hyrox Zurich race dates\n- Book physio\n')
    const item = parseInbox(two, FILE).find((i) => i.text.includes('Book physio'))!
    expect(removeInboxItem(two, FILE, item.id)).toBe(base)
  })
})
