import { describe, expect, it } from 'vitest'
import type { CalEvent } from '@shared/types'
import { BRIEF_FORMAT, DEFAULT_BRIEF_TEMPLATE, buildBriefPrompt } from '../electron/main/context/brief'

const events: CalEvent[] = [
  { id: 'e1', calendarId: 'c', calendarName: 'Study Schedule', title: 'Thesis meeting', start: '2026-11-09T10:00:00', end: '2026-11-09T11:00:00', allDay: false }
]
const date = '2026-11-09'

describe('buildBriefPrompt', () => {
  it('substitutes the placeholders in the default template', () => {
    const p = buildBriefPrompt(DEFAULT_BRIEF_TEMPLATE, { date, events, includeEmail: true })
    expect(p).not.toMatch(/\{\{(date|calendar|email)\}\}/)
    expect(p).toContain(`morning brief for ${date}`)
    expect(p).toContain('- 10:00–11:00 Thesis meeting (Study Schedule)')
    expect(p).not.toContain('Context (added by the app)')
  })

  it('changes the email line with includeEmail', () => {
    const on = buildBriefPrompt(DEFAULT_BRIEF_TEMPLATE, { date, events, includeEmail: true })
    const off = buildBriefPrompt(DEFAULT_BRIEF_TEMPLATE, { date, events, includeEmail: false })
    expect(on).toContain('Search Gmail')
    expect(on).not.toContain('Skip email entirely')
    expect(off).toContain('Skip email entirely')
    expect(off).not.toContain('Search Gmail')
  })

  it('always appends the fixed output format, even to a custom template without headings', () => {
    const p = buildBriefPrompt('Brief for {{date}}. {{email}}\n{{calendar}}\nBe very short.', { date, events, includeEmail: false })
    expect(p.endsWith(BRIEF_FORMAT)).toBe(true)
    for (const h of ['## Calendar', '## Emails / Attention', '## Suggested Priorities', '## AI Preparation Opportunities', '## Temporary Inbox Suggestions']) expect(p).toContain(h)
    expect(p).toContain('You can only read.')
    expect(DEFAULT_BRIEF_TEMPLATE).not.toContain('## ')
  })

  it('appends date, calendar and email in a labelled context section when the template omits them', () => {
    const p = buildBriefPrompt('Just tell me what matters today.', { date, events, includeEmail: true })
    const ctx = p.indexOf('Context (added by the app):')
    expect(ctx).toBeGreaterThan(p.indexOf('Just tell me'))
    expect(ctx).toBeLessThan(p.indexOf(BRIEF_FORMAT))
    const section = p.slice(ctx, p.indexOf(BRIEF_FORMAT))
    expect(section).toContain(`Date: ${date}`)
    expect(section).toContain('Thesis meeting')
    expect(section).toContain('Search Gmail')
  })

  it('appends only what is missing and handles an empty calendar', () => {
    const p = buildBriefPrompt('Brief for {{date}}.', { date, events: [], includeEmail: false })
    const section = p.slice(p.indexOf('Context (added by the app):'))
    expect(section).not.toContain('Date:')
    expect(section).toContain('not provided')
  })
})
