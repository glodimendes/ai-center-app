import { NO_AREA, noAreaCategory } from '@shared/categories'
import type { AppState } from '@shared/api'
import type { CategoryPref, Task } from '@shared/types'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function categoryOf(state: AppState, key: string): CategoryPref {
  const cats = state.vault.preferences.categories
  if (key === NO_AREA) return noAreaCategory(cats)
  return cats.find((c) => c.key === key) ?? cats.find((c) => c.key === 'other') ?? cats[0]
}

export function calendarColor(state: AppState, name: string): string | undefined {
  return state.calendar.calendars.find((c) => c.name === name)?.color
}

/** Minimal inline markdown: **bold**, `code`, [text](url). Returns safe HTML. */
export function inlineMd(s: string): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="px-1 rounded bg-sunken text-[12px]">$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a class="text-accent underline" href="$2" target="_blank">$1</a>')
}

export const plainTitle = (t: Task) => t.title.replace(/\*\*|`/g, '')

export function relDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  const diff = Math.round((d.getTime() - t.getTime()) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff < 0) return `${-diff}d overdue`
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Parse "1h30", "90", "1.5h", "45m" into minutes. */
export function parseMinutes(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/\s+/g, '')
  if (!t) return null
  let m = t.match(/^(\d+(?:[.,]\d+)?)h(?:(\d+)m?)?$/)
  if (m) return Math.round(Number(m[1].replace(',', '.')) * 60 + (m[2] ? Number(m[2]) : 0))
  m = t.match(/^(\d+)m?$/)
  if (m) return Number(m[1])
  m = t.match(/^(\d+):(\d{2})$/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  return null
}
