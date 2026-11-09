import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { addDays, fmtDuration, isoDate, parseDate } from '@shared/time'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { blockMinutes, gridItems, logFor, moveEvent, pinForTask, pinFromBlock } from '@/lib/plan'
import { categoryOf, cx } from '@/lib/util'
import type { AppState } from '@shared/api'
import type { Task } from '@shared/types'
import { TimeGrid } from '@/components/TimeGrid'
import { BlockPanel } from '@/components/BlockPanel'
import { TaskRow } from '@/components/TaskRow'
import { QuickAdd } from '@/components/QuickAdd'
import { ReplanButton } from '@/components/ReplanButton'
import { CalendarFilter } from '@/components/CalendarFilter'
import { AddBlockButton, NewBlockDialog, type BlockDraft } from '@/components/NewBlock'
import { Button, Dot, Header } from '@/components/ui'

export function Today() {
  const { state, day, setDay, selectedBlockId, selectBlock, go } = useStore()
  const s = state!
  const [view, setView] = useTaskView()
  const [draft, setDraft] = useState<BlockDraft | null>(null)
  const filter = view.q
  const { items, allDay } = useMemo(() => gridItems(s, [day]), [s, day])
  const date = parseDate(day)
  const isToday = day === isoDate(new Date())

  const dayBlocks = s.plan.blocks.filter((b) => b.start.slice(0, 10) === day && b.kind !== 'break')
  const plannedByCat = new Map<string, number>()
  for (const b of dayBlocks) plannedByCat.set(b.category, (plannedByCat.get(b.category) ?? 0) + blockMinutes(b))
  const toLog = dayBlocks.filter((b) => new Date(b.end) < new Date() && !logFor(s, b) && (b.chunks.length || b.kind !== 'topup'))

  const ordered = useMemo(() => {
    const open = s.vault.tasks.filter((t) => !t.done && !t.childIds.some((id) => s.vault.tasks.find((c) => c.id === id && !c.done)))
    const q = filter.toLowerCase()
    const show = SHOW.find((x) => x.key === view.show)!.test
    return open
      .filter((t) => !q || t.title.toLowerCase().includes(q) || t.section.join(' ').toLowerCase().includes(q))
      .filter((t) => !view.areas.length || view.areas.includes(t.category))
      .filter((t) => show(t, s))
      .sort(SORTS.find((x) => x.key === view.sort)!.cmp(s))
  }, [s, filter, view])
  // On this day: in the order of their first block that day.
  const firstStart = (id: string) => dayBlocks.filter((b) => b.chunks.some((c) => c.taskId === id)).map((b) => b.start).sort()[0]
  const todays = ordered.filter((t) => firstStart(t.id)).sort((a, b) => firstStart(a.id).localeCompare(firstStart(b.id)))
  const later = ordered.filter((t) => !firstStart(t.id))
  const usedAreas = [...new Set(s.vault.tasks.filter((t) => !t.done).map((t) => t.category))]
  const alertCount = s.plan.warnings.length

  const onMove = async (id: string, start: string, end: string) => {
    if (await moveEvent(s, id, start, end)) return
    const b = s.plan.blocks.find((x) => x.id === id)
    if (b) await act(api.pin(pinFromBlock(b, start, end)))
  }
  const onDropTask = async (taskId: string, start: string) => {
    const pin = pinForTask(s, taskId, start)
    if (pin) await act(api.pin(pin), `Scheduled at ${start.slice(11, 16)}`)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Header
        title={isToday ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'long' })}
        sub={date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
      >
        {alertCount > 0 && (
          <Button kind="ghost" onClick={() => go('alerts')} className="text-warn" title="Open Alerts">
            <AlertTriangle size={13} /> {alertCount}
          </Button>
        )}
        <AddBlockButton day={day} onOpen={setDraft} />
        <ReplanButton />
        <CalendarFilter />
        <Button kind="ghost" onClick={() => act(api.refreshCalendar())} title="Refresh calendar">
          <RefreshCw size={13} />
        </Button>
        <Button onClick={() => setDay(isoDate(addDays(date, -1)))}>
          <ChevronLeft size={14} />
        </Button>
        <Button onClick={() => setDay(isoDate(new Date()))} disabled={isToday}>
          Today
        </Button>
        <Button onClick={() => setDay(isoDate(addDays(date, 1)))}>
          <ChevronRight size={14} />
        </Button>
      </Header>


      <div className="flex-1 min-h-0 flex">
        <section className="w-[380px] shrink-0 border-r border-line flex flex-col min-h-0">
          <div className="px-4 pt-3 pb-2 flex flex-wrap gap-x-3 gap-y-1">
            {[...plannedByCat].map(([k, m]) => (
              <span key={k} className="flex items-center gap-1.5 text-[11.5px] text-muted">
                <Dot color={categoryOf(s, k).color} /> {categoryOf(s, k).label} {fmtDuration(m)}
              </span>
            ))}
            {!plannedByCat.size && <span className="text-[11.5px] text-faint">Nothing planned for this day.</span>}
          </div>
          {toLog.length > 0 && (
            <button onClick={() => selectBlock(toLog[0].id)} className="mx-3 mb-2 px-3 py-2 rounded-md bg-accent-soft text-[12px] text-left">
              <span className="font-medium text-accent">{toLog.length} block{toLog.length > 1 ? 's' : ''} to log</span>
              <span className="text-muted">: record how long you actually spent</span>
            </button>
          )}
          <div className="px-3 pb-2 flex flex-col gap-1.5">
            <input
              value={filter}
              onChange={(e) => setView({ q: e.target.value })}
              placeholder="Search tasks…"
              className="w-full h-7 px-2.5 rounded-md bg-sunken text-[12.5px] outline-none placeholder:text-faint"
            />
            <div className="flex gap-1.5 text-[11.5px]">
              <label className="flex-1 flex items-center gap-1 text-faint">
                Sort
                <select value={view.sort} onChange={(e) => setView({ sort: e.target.value })} className="flex-1 min-w-0 h-6 rounded border border-line bg-bg text-ink">
                  {SORTS.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex-1 flex items-center gap-1 text-faint">
                Show
                <select value={view.show} onChange={(e) => setView({ show: e.target.value })} className="flex-1 min-w-0 h-6 rounded border border-line bg-bg text-ink">
                  {SHOW.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-1">
              {usedAreas.map((k) => {
                const on = view.areas.includes(k)
                return (
                  <button
                    key={k}
                    onClick={() => setView({ areas: on ? view.areas.filter((x) => x !== k) : [...view.areas, k] })}
                    className={cx('flex items-center gap-1 px-1.5 h-5 rounded-full border text-[10.5px]', on ? 'border-accent bg-accent-soft text-ink' : 'border-line text-muted hover:bg-sunken')}
                  >
                    <Dot color={categoryOf(s, k).color} /> {categoryOf(s, k).label}
                  </button>
                )
              })}
              {(view.areas.length > 0 || view.show !== 'all' || view.q) && (
                <button onClick={() => setView({ areas: [], show: 'all', q: '' })} className="px-1.5 h-5 text-[10.5px] text-accent">
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-4">
            <QuickAdd />
            {todays.length > 0 && <h3 className="px-2 pt-3 pb-1 text-[11px] uppercase tracking-wide text-faint">On this day</h3>}
            {todays.map((t) => (
              <TaskRow key={t.id} task={t} draggable showSection />
            ))}
            <h3 className="px-2 pt-3 pb-1 text-[11px] uppercase tracking-wide text-faint">{todays.length ? 'Other tasks' : 'Tasks'} · drag onto the timeline</h3>
            {!ordered.length && <div className="px-2 py-2 text-[12px] text-faint">No tasks match.</div>}
            {later.map((t) => (
              <TaskRow key={t.id} task={t} draggable showSection />
            ))}
          </div>
        </section>

        <TimeGrid
          days={[day]}
          items={items}
          allDay={allDay}
          selectedId={selectedBlockId}
          onSelect={selectBlock}
          onMove={onMove}
          onCreate={(start, end) => setDraft({ start, end })}
          onDropTask={onDropTask}
          onDropTaskOnBlock={(taskId, blockId) => act(api.addTaskToBlock(blockId, taskId), 'Added to block')}
        />
        <BlockPanel />
      </div>
      {draft && <NewBlockDialog draft={draft} onClose={() => setDraft(null)} />}
    </div>
  )
}

const PRI = { urgent: 0, high: 1, medium: 2, low: 3 } as const
const finish = (s: AppState, t: Task) => s.plan.taskFinish[t.id] ?? '9999'
const byDue = (a: Task, b: Task) => (a.due ?? '9999').localeCompare(b.due ?? '9999')

const SORTS: { key: string; label: string; cmp: (s: AppState) => (a: Task, b: Task) => number }[] = [
  { key: 'plan', label: 'Planned time', cmp: (s) => (a, b) => finish(s, a).localeCompare(finish(s, b)) },
  { key: 'due', label: 'Deadline', cmp: (s) => (a, b) => byDue(a, b) || finish(s, a).localeCompare(finish(s, b)) },
  { key: 'priority', label: 'Priority', cmp: (s) => (a, b) => PRI[a.priority] - PRI[b.priority] || byDue(a, b) || finish(s, a).localeCompare(finish(s, b)) },
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

const SHOW: { key: string; label: string; test: (t: Task, s: AppState) => boolean }[] = [
  { key: 'all', label: 'All open', test: () => true },
  { key: 'planned', label: 'Planned', test: (t, s) => Boolean(s.plan.taskFinish[t.id]) },
  { key: 'unplanned', label: 'Not planned', test: (t, s) => !s.plan.taskFinish[t.id] },
  { key: 'overdue', label: 'Overdue', test: (t) => Boolean(t.due && t.due < isoDate(new Date())) },
  { key: 'due', label: 'With deadline', test: (t) => Boolean(t.due) },
  { key: 'high', label: 'High or urgent', test: (t) => t.priority === 'high' || t.priority === 'urgent' },
  { key: 'repeat', label: 'Repeating', test: (t) => Boolean(t.repeat) },
  { key: 'postponed', label: 'Postponed', test: (t) => Boolean(t.postponed && t.postponed > isoDate(new Date())) },
  { key: 'alerts', label: 'With alerts', test: (t, s) => s.plan.warnings.some((w) => w.taskId === t.id) }
]

interface TaskView {
  q: string
  sort: string
  show: string
  areas: string[]
}
const VIEW_KEY = 'today-task-view'
const DEFAULT_VIEW: TaskView = { q: '', sort: 'plan', show: 'all', areas: [] }

/** Sort and filters, remembered on this Mac (search text excluded). */
function useTaskView(): [TaskView, (patch: Partial<TaskView>) => void] {
  const [view, setState] = useState<TaskView>(() => {
    try {
      const v = { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}'), q: '' }
      return SORTS.some((x) => x.key === v.sort) && SHOW.some((x) => x.key === v.show) ? v : DEFAULT_VIEW
    } catch {
      return DEFAULT_VIEW
    }
  })
  const set = (patch: Partial<TaskView>) =>
    setState((v) => {
      const next = { ...v, ...patch }
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify({ ...next, q: '' }))
      } catch {
        /* per-device convenience only */
      }
      return next
    })
  return [view, set]
}
