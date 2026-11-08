import type { Priority, Timing } from '@shared/types'

// Inline task metadata. Everything is optional so plain checklist lines keep working.
//   ~2h  ~45m  ~1h30m  ~1.5h        estimate
//   due:2026-11-12                  deadline (canonical)
//   by 31/10  by 05.11  by 1/9/2027 deadline (the user's existing style)
//   !high  !medium  !low            priority
//   @spread  @asap                  timing override (spread evenly until the deadline / as soon as possible)

const ESTIMATE_RE = /(^|\s)~(\d+(?:\.\d+)?h(?:\d+m)?|\d+m)(?=\s|$)/
const DUE_ISO_RE = /(^|\s)due:(\d{4}-\d{2}-\d{2})(?=\s|$)/
const DUE_BY_RE = /(\s[-–—]\s*|\s)by\s+(\d{1,2})([./])(\d{1,2})(?:\3(\d{2,4}))?(?=[\s,.;)]|$)/i
const PRIORITY_RE = /(^|\s)!(high|medium|low)(?=\s|$)/i
const TIMING_RE = /(^|\s)@(spread|asap)(?=\s|$)/i

export interface ParsedTokens {
  title: string
  estimateMin?: number
  due?: string
  dueStyle?: 'iso' | 'by-slash' | 'by-dot'
  priority?: Priority
  timing?: Timing
}

export function parseDuration(token: string): number | undefined {
  const m = token.match(/^(\d+(?:\.\d+)?)h(?:(\d+)m)?$|^(\d+)m$/)
  if (!m) return undefined
  if (m[3]) return Number(m[3])
  return Math.round(Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0))
}

export function formatDuration(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h && m) return `${h}h${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

const pad = (n: number) => String(n).padStart(2, '0')
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Year for a day/month with no year: keep it within roughly ±6 months of today. */
export function inferYear(day: number, month: number, today: Date): number {
  const y = today.getFullYear()
  const candidate = new Date(y, month - 1, day)
  const diffDays = (candidate.getTime() - today.getTime()) / 86_400_000
  if (diffDays > 185) return y - 1
  if (diffDays < -180) return y + 1
  return y
}

export function parseTokens(text: string, today: Date): ParsedTokens {
  let title = text
  const out: ParsedTokens = { title: '' }

  const est = title.match(ESTIMATE_RE)
  if (est) {
    out.estimateMin = parseDuration(est[2])
    title = title.replace(ESTIMATE_RE, '$1')
  }

  const iso = title.match(DUE_ISO_RE)
  if (iso) {
    out.due = iso[2]
    out.dueStyle = 'iso'
    title = title.replace(DUE_ISO_RE, '$1')
  } else {
    const by = title.match(DUE_BY_RE)
    if (by) {
      const day = Number(by[2])
      const month = Number(by[4])
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        let year = by[5] ? Number(by[5]) : inferYear(day, month, today)
        if (year < 100) year += 2000
        out.due = `${year}-${pad(month)}-${pad(day)}`
        out.dueStyle = by[3] === '.' ? 'by-dot' : 'by-slash'
        title = title.replace(DUE_BY_RE, '')
      }
    }
  }

  const pri = title.match(PRIORITY_RE)
  if (pri) {
    out.priority = pri[2].toLowerCase() as Priority
    title = title.replace(PRIORITY_RE, '$1')
  }

  const tim = title.match(TIMING_RE)
  if (tim) {
    out.timing = tim[2].toLowerCase() as Timing
    title = title.replace(TIMING_RE, '$1')
  }

  out.title = title.replace(/\s{2,}/g, ' ').trim()
  return out
}

function formatDue(due: string, style: ParsedTokens['dueStyle']): string {
  if (style === 'by-slash' || style === 'by-dot') {
    const [, m, d] = due.split('-')
    const sep = style === 'by-dot' ? '.' : '/'
    return `by ${d}${sep}${m}`
  }
  return `due:${due}`
}

export interface TokenEdit {
  title?: string
  estimateMin?: number | null
  due?: string | null
  priority?: Priority
  timing?: Timing | null
}

/**
 * Edit the metadata of a task body in place: existing tokens are replaced where they
 * stand, new tokens are appended, removed tokens are cut. A title change rebuilds the
 * body as `title + tokens`.
 */
export function editTokens(body: string, edit: TokenEdit, today: Date): string {
  const parsed = parseTokens(body, today)
  if (edit.title !== undefined && edit.title.trim() !== parsed.title) {
    const est = edit.estimateMin === undefined ? parsed.estimateMin : edit.estimateMin ?? undefined
    const due = edit.due === undefined ? parsed.due : edit.due ?? undefined
    const pri = edit.priority ?? parsed.priority
    const parts = [edit.title.trim()]
    if (due) parts.push(formatDue(due, parsed.dueStyle))
    if (est) parts.push(`~${formatDuration(est)}`)
    if (pri && pri !== 'medium') parts.push(`!${pri}`)
    const tim = edit.timing === undefined ? parsed.timing : edit.timing ?? undefined
    if (tim) parts.push(`@${tim}`)
    return parts.join(' ')
  }

  let out = body
  if (edit.estimateMin !== undefined) {
    if (edit.estimateMin === null) out = out.replace(ESTIMATE_RE, '$1')
    else if (ESTIMATE_RE.test(out)) out = out.replace(ESTIMATE_RE, `$1~${formatDuration(edit.estimateMin)}`)
    else out = `${out.trimEnd()} ~${formatDuration(edit.estimateMin)}`
  }
  if (edit.due !== undefined) {
    const style = parsed.dueStyle
    if (DUE_ISO_RE.test(out)) {
      out = edit.due === null ? out.replace(DUE_ISO_RE, '$1') : out.replace(DUE_ISO_RE, `$1due:${edit.due}`)
    } else if (parsed.dueStyle && DUE_BY_RE.test(out)) {
      out = edit.due === null ? out.replace(DUE_BY_RE, '') : out.replace(DUE_BY_RE, (_m, lead) => `${lead}${formatDue(edit.due as string, style)}`)
    } else if (edit.due !== null) {
      out = `${out.trimEnd()} due:${edit.due}`
    }
  }
  if (edit.priority !== undefined) {
    const token = edit.priority === 'medium' ? '' : `!${edit.priority}`
    if (PRIORITY_RE.test(out)) out = out.replace(PRIORITY_RE, token ? `$1${token}` : '$1')
    else if (token) out = `${out.trimEnd()} ${token}`
  }
  if (edit.timing !== undefined) {
    const token = edit.timing ? `@${edit.timing}` : ''
    if (TIMING_RE.test(out)) out = out.replace(TIMING_RE, token ? `$1${token}` : '$1')
    else if (token) out = `${out.trimEnd()} ${token}`
  }
  return out.replace(/[ \t]{2,}/g, ' ').trimEnd()
}
