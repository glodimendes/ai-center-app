import { spawn } from 'node:child_process'
import type { CalEvent } from '@shared/types'
import { CONTEXT_MODELS, resolveBinary } from './agent'

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

// The user may edit the instructions (stored in the vault at 06_Prompts/daily-brief.md), but the
// output format is always appended: the app parses those exact headings.
export const DEFAULT_BRIEF_TEMPLATE = `Give me a concise morning brief for {{date}} covering today's calendar, important emails (if included) and anything requiring my attention.

The current directory is my AI Center vault (canonical path /Users/glodimendes/Documents/Personal Vault/AI Center).
- Check 05_Tasks/daily-todos.md for today's open todos.
- Check 05_Tasks/ for active task notes and handoffs.
- Use 02_Projects/ and 04_Context_Docs/ only when clearly relevant to today's calendar, emails, todos or task notes.
- Don't reread 00_START_HERE.md.
{{email}}

Today's calendar (from my calendars):
{{calendar}}`

export const BRIEF_FORMAT = `You can only read. Do not draft, send, label or delete anything.

Under "Calendar", use only the events given above: they are the calendars I chose.

Reply with ONLY the brief in Markdown, using exactly these level-2 headings, in this order:
## Calendar
## Emails / Attention
## Todos by Topic
## Active Task Notes
## Suggested Priorities
## AI Preparation Opportunities
## Temporary Inbox Suggestions

Keep it concise, actionable and grouped by topic, as checklists.
Under "Temporary Inbox Suggestions": only items an email or event clearly turns into a task, one per line as "- <task text>", or "- none". Don't turn every email or event into a task.
Under "AI Preparation Opportunities": at most three safe, high-value preparation tasks (specific, bounded, reviewable, low-risk). For each state: proposed outcome, why now, minimum inputs, what the agent will and will not do, and the review or decision needed from me. Suggest none when my intention is unclear, the information is sensitive, the output could create a commitment, or the task needs my judgment, relationships or authority.`

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
  const bin = await resolveBinary('claude')
  const allowed = includeEmail ? READ_TOOLS : READ_TOOLS.filter((t) => !t.includes('Gmail'))
  const child = spawn(
    bin,
    [
      '-p',
      buildBriefPrompt(template, { date, events, includeEmail }),
      '--model',
      CONTEXT_MODELS.claude.model,
      '--effort',
      CONTEXT_MODELS.claude.effort,
      '--output-format',
      'stream-json',
      '--verbose',
      '--allowedTools',
      ...allowed,
      '--disallowedTools',
      ...BLOCKED,
      '--no-session-persistence'
    ],
    { cwd: vault, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let buf = ''
  let result = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => {
    buf += chunk.toString()
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      try {
        const ev = JSON.parse(line)
        if (ev.type === 'assistant')
          for (const c of ev.message?.content ?? []) {
            if (c.type !== 'tool_use') continue
            const name = String(c.name)
            if (name.includes('Gmail')) onProgress('Reading email…')
            else if (name.includes('Calendar')) onProgress('Checking calendar…')
            else if (name === 'Read') onProgress(`Reading ${String(c.input?.file_path ?? '').replace(vault + '/', '')}`)
          }
        if (ev.type === 'result') result = String(ev.result ?? '')
      } catch {
        /* noise */
      }
    }
  })
  child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => child.kill('SIGTERM'), 5 * 60_000)
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      const md = result.trim()
      if (!md.includes('## ')) return reject(new Error(stderr.trim().split('\n').slice(-2).join(' ') || `The brief run ended without a brief (code ${code}).`))
      resolve(md)
    })
  })
}
