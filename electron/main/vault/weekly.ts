import { dump, load } from 'js-yaml'
import type { CategoryPref, LogEntry, Pin, WeekData } from '@shared/types'
import { fmtDuration } from '@shared/time'

export const WEEKLY_DIR = '05_Tasks/weekly'
export const weeklyFile = (week: string) => `${WEEKLY_DIR}/${week}.md`

const DATA_RE = /```yaml planner\r?\n([\s\S]*?)```/

export function parseWeekly(text: string, week: string): WeekData {
  const m = text.match(DATA_RE)
  const data = (m ? load(m[1]) : null) as Partial<WeekData> | null
  return { week, log: data?.log ?? [], pins: data?.pins ?? [] }
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** The app owns this file: a readable summary plus a YAML block it parses back. */
export function serializeWeekly(data: WeekData, categories: CategoryPref[]): string {
  const label = (key: string) => categories.find((c) => c.key === key)?.label ?? key
  const log = [...data.log].sort((a, b) => a.start.localeCompare(b.start))
  const totals = new Map<string, { planned: number; actual: number }>()
  for (const e of log) {
    const t = totals.get(e.category) ?? { planned: 0, actual: 0 }
    t.planned += e.plannedMin
    t.actual += e.actualMin
    totals.set(e.category, t)
  }

  const rows = log.map(
    (e: LogEntry) =>
      `| ${e.start.slice(0, 10)} ${e.start.slice(11, 16)} | ${cell(e.title)} | ${label(e.category)} | ${fmtDuration(e.plannedMin)} | ${fmtDuration(e.actualMin)} | ${e.status} | ${cell(e.note ?? '')} |`
  )
  const totalRows = [...totals].map(([k, t]) => `| ${label(k)} | ${fmtDuration(t.planned)} | ${fmtDuration(t.actual)} |`)

  return [
    `# Week ${data.week}`,
    '',
    'Written by the AI Center Planner app: planned vs actual time per logged block. The YAML block at the end is what the app reads; edit it carefully.',
    '',
    '## Totals',
    '',
    '| Category | Planned | Actual |',
    '| --- | --- | --- |',
    ...(totalRows.length ? totalRows : ['| — | — | — |']),
    '',
    '## Log',
    '',
    '| When | Block | Category | Planned | Actual | Status | Note |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...(rows.length ? rows : ['| — | — | — | — | — | — | — |']),
    '',
    '## Data',
    '',
    '```yaml planner',
    dump({ log: data.log, pins: data.pins satisfies Pin[] }, { lineWidth: 160 }).trimEnd(),
    '```',
    ''
  ].join('\n')
}
