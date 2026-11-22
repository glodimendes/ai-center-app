import type { CalEvent } from '@shared/types'
import { BRIEFS_DIR, CONTEXT_DIR, PRIORITIES_FILE, PROJECTS_DIR, START_FILE, TODOS_FILE } from '@shared/paths'
import { ENGINES, EngineTimeout, failureMessage, runEngine } from '../agents/engines'
import { findProfile } from '../agents/profiles'

// In-app daily brief. Runs Claude Code headlessly (cheapest model) inside the vault with read-only
// tools: vault files and Gmail reads. Calendar events come only from the app (the calendars shown in
// it), so it has no calendar tools. It cannot write files or touch email; the app saves the returned
// Markdown itself, and suggested todo items wait for the user's click.

const READ_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'mcp__claude_ai_Gmail__search_threads',
  'mcp__claude_ai_Gmail__get_thread',
  'mcp__claude_ai_Gmail__get_message',
  'ToolSearch'
]
const BLOCKED = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'mcp__claude_ai_Google_Calendar']

// The user may edit the instructions (stored in the vault at BRIEF_PROMPT_FILE), but the
// output format is always appended: the app parses those exact headings.
export const DEFAULT_BRIEF_TEMPLATE = `Give me a concise morning brief for {{date}} covering today's calendar, important emails (if included) and anything requiring my attention.

The current directory is my AI Center vault.
- Read ${TODOS_FILE} for today's open todos; mark overdue items and anything due in the next 3 days.
- Read ${PRIORITIES_FILE} and order everything by it.
- Read yesterday's file in ${BRIEFS_DIR}/ only to carry over items that are still open.
- Open ${PROJECTS_DIR}/ or ${CONTEXT_DIR}/ files only when an email, event or todo concerns them.
- Don't reread ${START_FILE}.
{{email}}

Today's calendar (from my calendars):
{{calendar}}`

export const BRIEF_FORMAT = `You can only read. Do not draft, send, label or delete anything.

Under "Calendar", use only the events given above: they are the calendars I chose.

Reply with ONLY the brief in Markdown, using exactly these level-2 headings, in this order:
## Calendar
## Emails / Attention
## Todos by Topic
## Suggested Priorities
## Temporary Inbox Suggestions

Keep it concise, actionable and grouped by topic, as checklists.
Under "Temporary Inbox Suggestions": only items an email or event clearly turns into a task, one per line as "- <task text>", or "- none". Don't turn every email or event into a task.`

export function formatCalendar(events: CalEvent[]) {
  return events.length
    ? events.map((e) => `- ${e.allDay ? 'all day' : `${e.start.slice(11, 16)}–${e.end.slice(11, 16)}`} ${e.title} (${e.calendarName})`).join('\n')
    : '(no events today in the calendars I chose; there are no other calendars to check)'
}

export function emailLine(includeEmail: boolean) {
  return includeEmail ? '- Search Gmail for unread or important messages from roughly the last 24 hours (read only).' : '- Skip email entirely.'
}

/** Template + fixed format. Context the template leaves out is appended, so an edit can't drop the calendar. */
export function buildBriefPrompt(template: string, { date, events, includeEmail }: { date: string; events: CalEvent[]; includeEmail: boolean }) {
  const values: Record<string, string> = { date, calendar: formatCalendar(events), email: emailLine(includeEmail) }
  const missing: string[] = []
  if (!template.includes('{{date}}')) missing.push(`Date: ${values.date}`)
  if (!template.includes('{{email}}')) missing.push(`Email: ${values.email.slice(2)}`)
  if (!template.includes('{{calendar}}')) missing.push(`Today's calendar (from my calendars):\n${values.calendar}`)
  const body = template.replace(/\{\{(date|calendar|email)\}\}/g, (_, k: string) => values[k]).trim()
  const context = missing.length ? `\n\nContext (added by the app):\n${missing.join('\n')}` : ''
  return `${body}${context}\n\n${BRIEF_FORMAT}`
}

export async function runBrief(vault: string, template: string, date: string, events: CalEvent[], includeEmail: boolean, onProgress: (line: string) => void): Promise<string> {
  const profile = findProfile('claude')
  const allowed = includeEmail ? READ_TOOLS : READ_TOOLS.filter((t) => !t.includes('Gmail'))
  const run = await runEngine(ENGINES[profile.engine], {
    profile,
    mode: 'tools',
    purpose: 'brief',
    prompt: buildBriefPrompt(template, { date, events, includeEmail }),
    cwd: vault,
    allowedTools: allowed,
    disallowedTools: BLOCKED,
    timeoutMs: 5 * 60_000,
    onEvent: (ev) => {
      if (ev.type !== 'tool') return
      if (ev.name.includes('Gmail')) onProgress('Reading email…')
      else if (ev.name.includes('Calendar')) onProgress('Checking calendar…')
      else if (ev.name === 'Read') onProgress(`Reading ${ev.target.replace(vault + '/', '')}`)
    }
  })
  try {
    const r = await run.done
    const md = r.text
    if (!md.includes('## ')) throw new Error(failureMessage(r.stderr, r.code, 'The brief'))
    return md
  } catch (e) {
    throw e instanceof EngineTimeout ? new Error('The brief took more than 5 minutes and was stopped. Try again later.') : e
  }
}
