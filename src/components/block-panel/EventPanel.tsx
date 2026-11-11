import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { CalEvent } from '@shared/types'
import { fmtHM, localISO, minutesOfDay } from '@shared/time'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { eventAvailability, eventLock } from '@/lib/plan'
import { cx } from '@/lib/util'
import { Button } from '../ui'

const hhmm = (iso: string) => fmtHM(minutesOfDay(new Date(iso)))
const dayOf = (iso: string) => localISO(new Date(iso)).slice(0, 10)

/** Hand edits of the user's own event (this occurrence only). Saved only on Save / Delete; nothing else changes events. */
export function EventEditor({ ev }: { ev: CalEvent }) {
  const state = useStore((s) => s.state)!
  const selectBlock = useStore((s) => s.selectBlock)
  const lock = eventLock(state, ev)
  const [title, setTitle] = useState(ev.title)
  const [day, setDay] = useState(dayOf(ev.start))
  const [from, setFrom] = useState(hhmm(ev.start))
  const [to, setTo] = useState(hhmm(ev.end))
  const [confirmDelete, setConfirmDelete] = useState(false)
  if (lock) return <p className="mt-4 text-[11.5px] text-faint">{lock}</p>

  const at = (d: string, t: string) => (/^\d{1,2}:\d{2}$/.test(t) ? `${d}T${t.padStart(5, '0')}:00` : null)
  const start = ev.allDay ? null : at(day, from)
  // An end before the start means it runs past midnight.
  const endSameDay = ev.allDay ? null : at(day, to)
  const end = start && endSameDay && endSameDay <= start ? localISO(new Date(new Date(endSameDay).getTime() + 86_400_000)) : endSameDay
  const timeChanged = !ev.allDay && start !== null && end !== null && (new Date(start).getTime() !== new Date(ev.start).getTime() || new Date(end).getTime() !== new Date(ev.end).getTime())
  const titleChanged = title.trim() !== ev.title
  const dirty = titleChanged || timeChanged

  const save = async () => {
    if (!ev.allDay && (!start || !end)) return useStore.getState().toast('Times look like 09:30.', 'error')
    const change = { ...(titleChanged ? { title: title.trim() } : {}), ...(timeChanged ? { start: start!, end: end! } : {}) }
    const id = await act(api.editEvent(ev.calendarId, ev.id, change), `Saved in ${ev.calendarName}`)
    if (typeof id === 'string') selectBlock(`ev:${ev.calendarId}:${id}`)
  }
  const remove = async () => {
    const ok = await act(api.deleteEvent(ev.calendarId, ev.id).then(() => true), `Deleted from ${ev.calendarName}`)
    if (ok) selectBlock(null)
  }

  const field = 'h-7 px-2 rounded-md border border-line bg-bg text-[12.5px]'
  return (
    <div className="mt-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-faint mb-1.5">Edit event</div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} className={cx(field, 'w-full')} />
      {!ev.allDay && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={cx(field, 'flex-1 min-w-0')} />
          <input value={from} onChange={(e) => setFrom(e.target.value)} className={cx(field, 'w-14 text-center')} />
          <span className="text-faint">–</span>
          <input value={to} onChange={(e) => setTo(e.target.value)} className={cx(field, 'w-14 text-center')} />
        </div>
      )}
      <div className="flex items-center gap-2 mt-2">
        <Button kind="primary" onClick={save} disabled={!dirty}>
          Save
        </Button>
        {!confirmDelete ? (
          <Button kind="ghost" onClick={() => setConfirmDelete(true)} className="text-danger">
            <Trash2 size={13} /> Delete
          </Button>
        ) : (
          <span className="flex items-center gap-1.5 text-[11.5px]">
            Delete it?
            <Button kind="danger" onClick={remove}>
              Yes, delete
            </Button>
            <Button kind="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-faint">Changes go to {ev.calendarName} (this occurrence only). You can also drag the event, or its bottom edge, on the grid.</p>
    </div>
  )
}

const AVAILABILITY_OPTIONS = [
  { value: 'busy', label: 'Busy' },
  { value: 'free', label: 'Free' },
  { value: null, label: 'Calendar default' }
] as const

/** Busy · Free · Calendar default, like Google/Apple's "show as busy/free"; the override lives in Settings, the event is never changed. */
export function EventAvailability({ ev }: { ev: CalEvent }) {
  const state = useStore((s) => s.state)!
  const { value, overridden } = eventAvailability(state, ev)
  const key = `${ev.calendarId}:${ev.id}`
  const selected = overridden ? value : null
  return (
    <div className="mt-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-faint mb-1.5">Show as</div>
      <div className="flex rounded-md border border-line overflow-hidden text-[12px]">
        {AVAILABILITY_OPTIONS.map((o) => (
          <button
            key={o.label}
            onClick={() => act(api.setEventAvailability(key, o.value))}
            className={cx('flex-1 px-2 h-7 border-r border-line last:border-r-0 transition-colors', selected === o.value ? 'bg-accent text-white' : 'hover:bg-sunken text-muted')}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] text-faint">
        {value === 'busy' ? 'Busy · plan around it.' : 'Free · may plan over it.'}
        {overridden ? ' Set here, overriding the calendar.' : ` From the calendar${ev.free ? '' : value === 'free' ? ` (${ev.calendarName} is set to Free)` : ''}.`} The planner never changes the event itself.
      </p>
    </div>
  )
}
