import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, CheckCircle2, Gauge, Hourglass, ShieldAlert, Timer } from 'lucide-react'
import type { PlanWarning, Task } from '@shared/types'
import { addDays, isoDate } from '@shared/time'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { categoryOf, cx } from '@/lib/util'
import { TaskRow } from '@/components/TaskRow'
import { Dot, Empty, Header } from '@/components/ui'

// Planner warnings as a worklist: one row per task (all its problems listed), grouped by the
// most serious one, with the fixes next to it.

type Group = 'overdue' | 'risk' | 'stale' | 'unscheduled' | 'budget' | 'conflict' | 'training'

const GROUPS: { key: Group; title: string; hint: string; icon: typeof AlertTriangle; tone: string }[] = [
  { key: 'overdue', title: 'Overdue', hint: 'Past the deadline. Move the deadline, finish it, or drop it.', icon: ShieldAlert, tone: 'text-danger' },
  { key: 'risk', title: "Won't make the deadline", hint: "The plan can't finish these in time. Lower the estimate, move the deadline, or raise the priority.", icon: AlertTriangle, tone: 'text-danger' },
  { key: 'stale', title: 'Stale', hint: 'Long overdue, so they are planned last. Reschedule or drop them.', icon: Hourglass, tone: 'text-warn' },
  { key: 'unscheduled', title: "Doesn't fit", hint: 'No room in the planning horizon. Lower the estimate, split the task, or free up time.', icon: Timer, tone: 'text-warn' },
  { key: 'budget', title: 'Weekly budgets', hint: 'Areas behind their weekly target or over their cap (Settings → Areas).', icon: Gauge, tone: 'text-warn' },
  { key: 'conflict', title: 'Calendar conflicts', hint: 'A planned block now clashes with a calendar event; its tasks were moved.', icon: CalendarClock, tone: 'text-warn' },
  { key: 'training', title: 'Other', hint: 'Other planner notes.', icon: AlertTriangle, tone: 'text-warn' }
]
const RANK: Group[] = ['overdue', 'risk', 'stale', 'unscheduled']

function groupOf(w: PlanWarning): Group {
  if (w.kind === 'deadline') return w.level ?? 'risk'
  if (w.kind === 'stale' || w.kind === 'unscheduled' || w.kind === 'conflict') return w.kind
  if (w.kind === 'budget-behind' || w.kind === 'budget-over') return 'budget'
  return 'training'
}

export interface AlertItem {
  group: Group
  task?: Task
  warnings: PlanWarning[]
}

/** Task warnings merged per task (most serious group first), plus the others as they are. */
export function alertItems(warnings: PlanWarning[], tasks: Task[]): AlertItem[] {
  const byTask = new Map<string, PlanWarning[]>()
  const out: AlertItem[] = []
  for (const w of warnings) {
    if (w.taskId) byTask.set(w.taskId, [...(byTask.get(w.taskId) ?? []), w])
    else out.push({ group: groupOf(w), warnings: [w] })
  }
  for (const [id, ws] of byTask) {
    const task = tasks.find((t) => t.id === id)
    if (!task) continue
    const group = RANK.find((g) => ws.some((w) => groupOf(w) === g)) ?? groupOf(ws[0])
    out.push({ group, task, warnings: ws.sort((a, b) => RANK.indexOf(groupOf(a)) - RANK.indexOf(groupOf(b))) })
  }
  return out
}

export function Alerts() {
  const { state, go, setDay, selectBlock } = useStore()
  const s = state!
  const [area, setArea] = useState<string | null>(null)
  const items = useMemo(() => alertItems(s.plan.warnings, s.vault.tasks), [s.plan.warnings, s.vault.tasks])
  const areas = [...new Set(items.map((i) => i.task?.category ?? i.warnings[0].category).filter((c): c is string => Boolean(c)))]
  const shown = items.filter((i) => !area || (i.task?.category ?? i.warnings[0].category) === area)

  const showInPlan = (taskId: string) => {
    const b = s.plan.blocks.find((x) => x.chunks.some((c) => c.taskId === taskId) && new Date(x.end) > new Date())
    if (!b) return
    setDay(b.start.slice(0, 10))
    go('today')
    selectBlock(b.id)
  }
  const due = (task: Task, iso: string | null) => act(api.patchTask(task.id, { due: iso }), iso ? `Deadline moved to ${iso}` : 'Deadline removed')

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Header title="Alerts" sub={items.length ? `${items.length} to look at` : 'All clear'} />
      <div className="px-5 @max-3xl:px-3 py-2 border-b border-line">
        <div className="flex flex-wrap gap-1">
          <Chip active={!area} onClick={() => setArea(null)}>
            All areas
          </Chip>
          {areas.map((k) => (
            <Chip key={k} active={area === k} onClick={() => setArea(area === k ? null : k)}>
              <Dot color={categoryOf(s, k).color} /> {categoryOf(s, k).label}
            </Chip>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 @max-3xl:px-3 py-5 flex flex-col gap-6">
          {!shown.length && (
            <Empty>
              <CheckCircle2 size={22} className="mx-auto mb-2 text-ok" />
              Nothing needs your attention{area ? ' in this area' : ''}.
            </Empty>
          )}
          {GROUPS.map((g) => {
            const list = shown.filter((i) => i.group === g.key)
            if (!list.length) return null
            return (
              <section key={g.key}>
                <div className="flex items-center gap-2">
                  <g.icon size={15} className={g.tone} />
                  <h2 className="text-[14px] font-semibold">{g.title}</h2>
                  <span className="text-[12px] text-faint">{list.length}</span>
                </div>
                <p className="text-[12px] text-muted mt-0.5 mb-2">{g.hint}</p>
                <div className="rounded-xl border border-line bg-panel divide-y divide-line">
                  {list.map((item, i) =>
                    item.task ? (
                      <div key={item.task.id} className="px-2 py-2">
                        <TaskRow task={item.task} showSection />
                        <div className="pl-8 pr-2 flex flex-col gap-0.5">
                          {item.warnings.map((w, j) => (
                            <div key={j} className={cx('text-[12px]', j === 0 ? g.tone : 'text-muted')}>
                              {w.detail ?? w.message}
                            </div>
                          ))}
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {(item.task.due || item.group === 'overdue' || item.group === 'risk' || item.group === 'stale') && (
                              <>
                                <span className="text-[11px] text-faint self-center mr-1">Deadline</span>
                                {[
                                  ['Today', 0],
                                  ['Tomorrow', 1],
                                  ['+3 days', 3],
                                  ['+1 week', 7]
                                ].map(([label, d]) => (
                                  <Small key={label} onClick={() => due(item.task!, isoDate(addDays(new Date(), d as number)))}>
                                    {label}
                                  </Small>
                                ))}
                                {item.task.due && <Small onClick={() => due(item.task!, null)}>Remove</Small>}
                                <span className="w-2" />
                              </>
                            )}
                            <Small onClick={() => act(api.completeTask(item.task!.id), 'Marked done')}>Mark done</Small>
                            {s.plan.blocks.some((b) => b.chunks.some((c) => c.taskId === item.task!.id) && new Date(b.end) > new Date()) && (
                              <Small onClick={() => showInPlan(item.task!.id)}>Show in plan</Small>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                        {item.warnings[0].category && <Dot color={categoryOf(s, item.warnings[0].category).color} />}
                        <span className="flex-1 text-[12.5px]">{item.warnings[0].message}</span>
                        {(g.key === 'budget' || g.key === 'training') && <Small onClick={() => go('settings')}>Open Settings</Small>}
                        {g.key === 'conflict' && <Small onClick={() => go('week')}>Open Week</Small>}
                      </div>
                    )
                  )}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cx('flex items-center gap-1.5 px-2 h-6 rounded-full border text-[11.5px]', active ? 'bg-accent text-white border-accent' : 'border-line text-muted hover:bg-sunken')}>
      {children}
    </button>
  )
}

function Small({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="px-2 h-6 rounded border border-line text-[11px] text-muted hover:bg-sunken hover:text-ink">
      {children}
    </button>
  )
}
