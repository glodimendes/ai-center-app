import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { addDays, fmtDuration, isoDate, parseDate } from '@shared/time'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { blockMinutes, gridItems, logFor, pinForTask, pinFromBlock } from '@/lib/plan'
import { categoryOf } from '@/lib/util'
import { TimeGrid } from '@/components/TimeGrid'
import { BlockPanel } from '@/components/BlockPanel'
import { TaskRow } from '@/components/TaskRow'
import { QuickAdd } from '@/components/QuickAdd'
import { Button, Dot, Header } from '@/components/ui'

export function Today() {
  const { state, day, setDay, selectedBlockId, selectBlock } = useStore()
  const s = state!
  const [filter, setFilter] = useState('')
  const [showWarnings, setShowWarnings] = useState(false)
  const { items, allDay } = useMemo(() => gridItems(s, [day]), [s, day])
  const date = parseDate(day)
  const isToday = day === isoDate(new Date())

  const dayBlocks = s.plan.blocks.filter((b) => b.start.slice(0, 10) === day)
  const plannedByCat = new Map<string, number>()
  for (const b of dayBlocks) plannedByCat.set(b.category, (plannedByCat.get(b.category) ?? 0) + blockMinutes(b))
  const toLog = dayBlocks.filter((b) => new Date(b.end) < new Date() && !logFor(s, b) && (b.chunks.length || b.kind !== 'topup'))

  const ordered = useMemo(() => {
    const open = s.vault.tasks.filter((t) => !t.done && !t.childIds.some((id) => s.vault.tasks.find((c) => c.id === id && !c.done)))
    const q = filter.toLowerCase()
    return open
      .filter((t) => !q || t.title.toLowerCase().includes(q) || t.section.join(' ').toLowerCase().includes(q))
      .sort((a, b) => (s.plan.taskFinish[a.id] ?? '9999').localeCompare(s.plan.taskFinish[b.id] ?? '9999'))
  }, [s, filter])
  const todays = ordered.filter((t) => dayBlocks.some((b) => b.chunks.some((c) => c.taskId === t.id)))
  const later = ordered.filter((t) => !todays.includes(t))

  const onMove = async (id: string, start: string, end: string) => {
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
        {s.plan.warnings.length > 0 && (
          <Button kind="ghost" onClick={() => setShowWarnings(!showWarnings)} className="text-warn">
            <AlertTriangle size={13} /> {s.plan.warnings.length}
          </Button>
        )}
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

      {showWarnings && (
        <div className="border-b border-line bg-warn-soft/60 px-5 py-2 max-h-40 overflow-y-auto text-[12px] text-warn">
          {s.plan.warnings.map((w, i) => (
            <div key={i} className="py-0.5">• {w.message}</div>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        <section className="w-[340px] shrink-0 border-r border-line flex flex-col min-h-0">
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
          <div className="px-3 pb-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter tasks…"
              className="w-full h-7 px-2.5 rounded-md bg-sunken text-[12.5px] outline-none placeholder:text-faint"
            />
          </div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-4">
            <QuickAdd />
            {todays.length > 0 && <h3 className="px-2 pt-3 pb-1 text-[11px] uppercase tracking-wide text-faint">On this day</h3>}
            {todays.map((t) => (
              <TaskRow key={t.id} task={t} draggable showSection />
            ))}
            <h3 className="px-2 pt-3 pb-1 text-[11px] uppercase tracking-wide text-faint">Up next · drag onto the timeline</h3>
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
          onDropTask={onDropTask}
        />
        <BlockPanel />
      </div>
    </div>
  )
}
