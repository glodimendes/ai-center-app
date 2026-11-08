import { useEffect, useRef, useState, type ReactNode } from 'react'
import { addDays, fmtHM, localISO, minutesOfDay, parseDate } from '@shared/time'
import { cx } from '@/lib/util'

export interface GridItem {
  id: string
  start: string
  end: string
  title: string
  subtitle?: ReactNode
  color: string
  /** 'solid' = planner block, 'outline' = calendar event, 'dashed' = proposed/unsynced. */
  look: 'solid' | 'outline' | 'dashed'
  draggable?: boolean
  dim?: boolean
  badge?: ReactNode
}

interface Props {
  days: string[]
  items: GridItem[]
  allDay?: { day: string; title: string; color: string }[]
  startHour?: number
  endHour?: number
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  onMove?: (id: string, start: string, end: string) => void
  onDropTask?: (taskId: string, start: string) => void
  onDayClick?: (day: string) => void
}

const HOUR_PX = 52
const SNAP = 15

interface Placed extends GridItem {
  top: number
  height: number
  col: number
  cols: number
}

/** Side-by-side layout for overlapping items within one day. */
function layout(items: GridItem[], startHour: number): Placed[] {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end))
  const out: Placed[] = []
  let cluster: Placed[] = []
  let clusterEnd = 0
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((p) => p.col + 1))
    cluster.forEach((p) => (p.cols = cols))
    out.push(...cluster)
    cluster = []
  }
  for (const it of sorted) {
    const s = minutesOfDay(new Date(it.start))
    const e = Math.max(s + 15, minutesOfDay(new Date(it.end)) || 24 * 60)
    if (cluster.length && s >= clusterEnd) flush()
    const used = new Set(cluster.filter((p) => (p.top + p.height) / HOUR_PX * 60 + startHour * 60 > s).map((p) => p.col))
    let col = 0
    while (used.has(col)) col++
    cluster.push({ ...it, top: ((s - startHour * 60) / 60) * HOUR_PX, height: Math.max(18, ((e - s) / 60) * HOUR_PX - 2), col, cols: 1 })
    clusterEnd = Math.max(clusterEnd, e)
  }
  flush()
  return out
}

export function TimeGrid({ days, items, allDay = [], startHour = 7, endHour = 23, selectedId, onSelect, onMove, onDropTask, onDayClick }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const cols = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ id: string; dy: number; dDay: number } | null>(null)
  const [dropHint, setDropHint] = useState<{ day: number; min: number } | null>(null)
  const [now, setNow] = useState(new Date())
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    // Scroll to an hour before now (or 8:00) on mount.
    const h = Math.max(startHour, Math.min(now.getHours() - 1, endHour - 6))
    scroller.current?.scrollTo({ top: (h - startHour) * HOUR_PX })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const minuteAt = (clientY: number) => {
    const rect = cols.current!.getBoundingClientRect()
    const min = ((clientY - rect.top) / HOUR_PX) * 60 + startHour * 60
    return Math.max(startHour * 60, Math.min(endHour * 60 - SNAP, Math.round(min / SNAP) * SNAP))
  }

  const startDrag = (e: React.PointerEvent, item: GridItem) => {
    if (!item.draggable || !onMove || e.button !== 0) return
    e.preventDefault()
    const startY = e.clientY
    const startX = e.clientX
    const colW = cols.current!.getBoundingClientRect().width / days.length
    let moved = false
    const onMoveEv = (ev: PointerEvent) => {
      const dy = Math.round(((ev.clientY - startY) / HOUR_PX) * 60 / SNAP) * SNAP
      const dDay = Math.round((ev.clientX - startX) / colW)
      if (Math.abs(ev.clientY - startY) > 3 || Math.abs(ev.clientX - startX) > 3) moved = true
      setDrag({ id: item.id, dy, dDay })
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMoveEv)
      window.removeEventListener('pointerup', onUp)
      setDrag(null)
      if (!moved) return onSelect?.(item.id)
      const dy = Math.round(((ev.clientY - startY) / HOUR_PX) * 60 / SNAP) * SNAP
      const dDay = Math.round((ev.clientX - startX) / colW)
      if (!dy && !dDay) return
      const s = new Date(new Date(item.start).getTime() + dy * 60_000)
      const e2 = new Date(new Date(item.end).getTime() + dy * 60_000)
      onMove(item.id, localISO(addDaysKeep(s, dDay)), localISO(addDaysKeep(e2, dDay)))
    }
    window.addEventListener('pointermove', onMoveEv)
    window.addEventListener('pointerup', onUp)
  }

  const todayIdx = days.indexOf(localISO(now).slice(0, 10))
  const nowTop = ((minutesOfDay(now) - startHour * 60) / 60) * HOUR_PX

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {days.length > 1 && (
        <div className="flex border-b border-line pl-14 pr-[10px]">
          {days.map((d, i) => {
            const date = parseDate(d)
            return (
              <button key={d} onClick={() => onDayClick?.(d)} className="flex-1 py-2 text-center hover:bg-sunken">
                <div className={cx('text-[11px] uppercase tracking-wide', i === todayIdx ? 'text-accent font-semibold' : 'text-muted')}>
                  {date.toLocaleDateString(undefined, { weekday: 'short' })}
                </div>
                <div className={cx('text-[15px] font-semibold', i === todayIdx && 'text-accent')}>{date.getDate()}</div>
              </button>
            )
          })}
        </div>
      )}
      {allDay.length > 0 && (
        <div className="flex border-b border-line pl-14 pr-[10px] py-1">
          {days.map((d) => (
            <div key={d} className="flex-1 px-0.5 flex flex-col gap-0.5">
              {allDay
                .filter((a) => a.day === d)
                .map((a, i) => (
                  <div key={i} className="truncate text-[11px] px-1.5 rounded" style={{ background: a.color + '22', color: a.color }}>
                    {a.title}
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
      <div ref={scroller} className="flex-1 overflow-y-auto relative" onMouseDown={(e) => e.target === e.currentTarget && onSelect?.(null)}>
        <div className="flex relative" style={{ height: hours.length * HOUR_PX }}>
          <div className="w-14 shrink-0 relative">
            {hours.map((h) => (
              <div key={h} className="absolute right-2 text-[10.5px] text-faint -translate-y-1/2" style={{ top: (h - startHour) * HOUR_PX }}>
                {h > startHour ? fmtHM(h * 60) : ''}
              </div>
            ))}
          </div>
          <div ref={cols} className="flex-1 flex relative">
            {hours.map((h) => (
              <div key={h} className="absolute left-0 right-0 border-t border-line/70" style={{ top: (h - startHour) * HOUR_PX }} />
            ))}
            {days.map((d, di) => {
              const dayItems = items.filter((it) => it.start.slice(0, 10) === d || (new Date(it.start) < parseDate(d) && new Date(it.end) > parseDate(d)))
              const placed = layout(
                dayItems.map((it) => (it.start.slice(0, 10) === d ? it : { ...it, start: localISO(parseDate(d)) })),
                startHour
              )
              return (
                <div
                  key={d}
                  className={cx('flex-1 relative border-l border-line/70', di === todayIdx && days.length > 1 && 'bg-accent-soft/30')}
                  onMouseDown={(e) => e.target === e.currentTarget && onSelect?.(null)}
                  onDragOver={(e) => {
                    if (!onDropTask || !e.dataTransfer.types.includes('application/x-task')) return
                    e.preventDefault()
                    setDropHint({ day: di, min: minuteAt(e.clientY) })
                  }}
                  onDragLeave={() => setDropHint(null)}
                  onDrop={(e) => {
                    const taskId = e.dataTransfer.getData('application/x-task')
                    setDropHint(null)
                    if (!taskId || !onDropTask) return
                    const min = minuteAt(e.clientY)
                    const date = parseDate(d)
                    date.setMinutes(min)
                    onDropTask(taskId, localISO(date))
                  }}
                >
                  {dropHint?.day === di && (
                    <div className="absolute left-1 right-1 h-0.5 bg-accent z-20" style={{ top: ((dropHint.min - startHour * 60) / 60) * HOUR_PX }}>
                      <span className="absolute -top-2.5 left-0 text-[10px] bg-accent text-white px-1 rounded">{fmtHM(dropHint.min)}</span>
                    </div>
                  )}
                  {placed.map((p) => {
                    const dragging = drag?.id === p.id
                    const offset = dragging ? (drag.dy / 60) * HOUR_PX : 0
                    const width = 100 / p.cols
                    return (
                      <div
                        key={p.id}
                        onPointerDown={(e) => (p.draggable ? startDrag(e, p) : undefined)}
                        onClick={() => !p.draggable && onSelect?.(p.id)}
                        className={cx(
                          'absolute rounded-md px-1.5 py-1 overflow-hidden text-[11.5px] leading-tight border',
                          p.draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                          p.look === 'outline' && 'bg-panel',
                          p.look === 'dashed' && 'border-dashed',
                          selectedId === p.id && 'ring-2 ring-accent z-10',
                          dragging && 'z-20 shadow-lg opacity-90',
                          p.dim && 'opacity-55'
                        )}
                        style={{
                          top: p.top + offset,
                          height: p.height,
                          left: `calc(${p.col * width}% + 2px)`,
                          width: `calc(${width}% - 4px)`,
                          transform: dragging && drag.dDay ? `translateX(${drag.dDay * 100 * p.cols}%)` : undefined,
                          background: p.look === 'outline' ? undefined : p.color + (p.look === 'dashed' ? '1a' : '2e'),
                          borderColor: p.color + (p.look === 'solid' ? '66' : '99'),
                          borderLeft: `3px solid ${p.color}`
                        }}
                      >
                        <div className="flex items-start gap-1">
                          <div className="font-medium truncate flex-1">{p.title}</div>
                          {p.badge}
                        </div>
                        {p.height > 30 && (
                          <div className="text-muted text-[10.5px]">
                            {fmtHM(minutesOfDay(new Date(p.start)))}–{fmtHM(minutesOfDay(new Date(p.end)))}
                          </div>
                        )}
                        {p.height > 46 && p.subtitle && <div className="text-muted text-[10.5px] mt-0.5 line-clamp-3">{p.subtitle}</div>}
                      </div>
                    )
                  })}
                  {di === todayIdx && nowTop > 0 && (
                    <div className="absolute left-0 right-0 h-px bg-danger z-10 pointer-events-none" style={{ top: nowTop }}>
                      <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-danger" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function addDaysKeep(d: Date, n: number) {
  const x = addDays(d, n)
  x.setHours(d.getHours(), d.getMinutes())
  return x
}
