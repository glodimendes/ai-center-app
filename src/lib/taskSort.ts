import type { AppState } from '@shared/api'
import type { Task } from '@shared/types'

const PRI = { urgent: 0, high: 1, medium: 2, low: 3 } as const
const finish = (s: AppState, t: Task) => s.plan.taskFinish[t.id] ?? '9999'
const byDue = (a: Task, b: Task) => (a.due ?? '9999').localeCompare(b.due ?? '9999')

export const SORTS: { key: string; label: string; cmp: (s: AppState) => (a: Task, b: Task) => number }[] = [
  { key: 'plan', label: 'Planned time', cmp: (s) => (a, b) => finish(s, a).localeCompare(finish(s, b)) },
  { key: 'due', label: 'Deadline', cmp: (s) => (a, b) => byDue(a, b) || finish(s, a).localeCompare(finish(s, b)) },
  { key: 'priority', label: 'Priority', cmp: (s) => (a, b) => PRI[a.priority] - PRI[b.priority] || byDue(a, b) || finish(s, a).localeCompare(finish(s, b)) },
  // Today only: in the Tasks view the area is the heading, which sorting never moves
  {
    key: 'area',
    label: 'Area',
    cmp: (s) => {
      const order = s.vault.preferences.categories.map((c) => c.key)
      return (a, b) => order.indexOf(a.category) - order.indexOf(b.category) || finish(s, a).localeCompare(finish(s, b))
    }
  },
  {
    key: 'estimate',
    label: 'Shortest first',
    cmp: (s) => {
      const est = (t: Task) => t.estimateMin ?? s.vault.preferences.categories.find((c) => c.key === t.category)?.defaultEstimateMinutes ?? 30
      return (a, b) => est(a) - est(b) || finish(s, a).localeCompare(finish(s, b))
    }
  },
  { key: 'file', label: 'As in the file', cmp: (s) => (a, b) => s.vault.tasks.indexOf(a) - s.vault.tasks.indexOf(b) }
]

/** Sorts offered in the Tasks view: the same ranking as Today, minus "Area" (headings keep their place). */
export const TASK_VIEW_SORTS = SORTS.filter((x) => x.key !== 'area')
