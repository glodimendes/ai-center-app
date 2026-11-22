import { useState } from 'react'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import type { Task } from '@shared/types'
import { addDays, isoDate, parseDate } from '@shared/time'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { categoryOf, cx, inlineMd } from '@/lib/util'
import { Dot } from '@/components/ui'

const fmtDay = (iso: string) => parseDate(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const daysLate = (iso: string, today: string) => Math.round((parseDate(today).getTime() - parseDate(iso).getTime()) / 86_400_000)
const lateLabel = (n: number) => (n === 1 ? 'yesterday' : n < 14 ? `${n} days late` : n < 60 ? `${Math.round(n / 7)} weeks late` : `${Math.round(n / 30)} months late`)

/** Open tasks due by the end of the week: what is already late (oldest first, collapsed), then one group per day. */
export function DueList({ tasks }: { tasks: Task[] }) {
  const today = isoDate(new Date())
  const [showAllLate, setShowAllLate] = useState(false)
  const late = tasks.filter((t) => t.due! < today).sort((a, b) => a.due!.localeCompare(b.due!))
  const upcoming = new Map<string, Task[]>()
  for (const t of tasks.filter((t) => t.due! >= today).sort((a, b) => a.due!.localeCompare(b.due!))) upcoming.set(t.due!, [...(upcoming.get(t.due!) ?? []), t])
  if (!tasks.length) return <p className="text-[12.5px] text-faint">Nothing due. Enjoy the quiet.</p>
  const lateShown = showAllLate ? late : late.slice(0, 5)

  return (
    <div className="flex flex-col gap-4">
      {late.length > 0 && (
        <Group title="Already late" count={late.length} tone="danger">
          {lateShown.map((t) => (
            <Row key={t.id} task={t} today={today} />
          ))}
          {late.length > 5 && (
            <button onClick={() => setShowAllLate(!showAllLate)} className="flex items-center gap-1 px-3 py-2 text-[12px] text-faint hover:text-ink">
              {showAllLate ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {showAllLate ? 'Show fewer' : `Show ${late.length - 5} more`}
            </button>
          )}
        </Group>
      )}
      {[...upcoming].map(([day, list]) => (
        <Group key={day} title={day === today ? 'Today' : day === isoDate(addDays(parseDate(today), 1)) ? 'Tomorrow' : fmtDay(day)} sub={day === today || day === isoDate(addDays(parseDate(today), 1)) ? fmtDay(day) : undefined} count={list.length}>
          {list.map((t) => (
            <Row key={t.id} task={t} today={today} />
          ))}
        </Group>
      ))}
    </div>
  )
}

function Group({ title, sub, count, tone, children }: { title: string; sub?: string; count: number; tone?: 'danger'; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline gap-2 px-1 mb-1">
        <h3 className={cx('text-[12.5px] font-semibold', tone === 'danger' && 'text-danger')}>{title}</h3>
        {sub && <span className="text-[11.5px] text-faint">{sub}</span>}
        <span className="text-[11.5px] text-faint">{count}</span>
      </div>
      <div className="rounded-xl border border-line/60 bg-panel divide-y divide-line/40 overflow-hidden">{children}</div>
    </section>
  )
}

function Row({ task, today }: { task: Task; today: string }) {
  const s = useStore((st) => st.state)!
  const n = task.due! < today ? daysLate(task.due!, today) : 0
  const tomorrow = isoDate(addDays(parseDate(today), 1))
  return (
    <div className="group flex items-center gap-3 px-3 py-2 hover:bg-sunken/50">
      <button
        onClick={() => void act(api.completeTask(task.id), 'Marked done')}
        title="Mark done"
        className="shrink-0 w-[18px] h-[18px] rounded-full border-[1.5px] border-faint grid place-items-center text-transparent hover:border-accent hover:text-accent"
      >
        <Check size={11} strokeWidth={3} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] break-words leading-snug" dangerouslySetInnerHTML={{ __html: inlineMd(task.title) }} />
        <div className="flex items-center gap-1.5 text-[11px] text-faint min-w-0">
          <Dot color={categoryOf(s, task.category).color} />
          <span className="truncate">{task.section.join(' › ')}</span>
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        <span className="hidden group-hover:flex items-center gap-1">
          {task.due !== tomorrow && (
            <button onClick={() => void act(api.patchTask(task.id, { due: tomorrow }), 'Moved to tomorrow')} className="h-6 px-2 rounded-md text-[11.5px] text-muted hover:bg-sunken hover:text-ink">
              Tomorrow
            </button>
          )}
          <label className="relative h-6 px-2 rounded-md text-[11.5px] text-muted hover:bg-sunken hover:text-ink grid place-items-center cursor-pointer" title="Pick a new deadline">
            Pick date
            <input
              type="date"
              defaultValue={task.due}
              onChange={(e) => e.target.value && void act(api.patchTask(task.id, { due: e.target.value }), 'Deadline moved')}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </label>
        </span>
        <span className={cx('text-[11.5px] whitespace-nowrap px-2 h-5 rounded-full grid place-items-center', n ? 'bg-danger/10 text-danger' : 'text-faint')} title={`Due ${task.due}`}>
          {n ? `${lateLabel(n)} · ${fmtDay(task.due!)}` : ''}
        </span>
      </div>
    </div>
  )
}
