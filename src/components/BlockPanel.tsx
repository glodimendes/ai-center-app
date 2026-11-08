import { useEffect, useMemo, useState } from 'react'
import { Check, Minus, Pin, PinOff, Plus, Trash2, X } from 'lucide-react'
import type { Block, CalEvent, LogStatus, Task } from '@shared/types'
import { fmtDuration, fmtHM, minutesOfDay } from '@shared/time'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { ACCEPTS_TASKS, REMOVABLE, blockMinutes, blockTitle, eventAvailability, eventKey, isSynced, logFor, pinFromBlock } from '@/lib/plan'
import { categoryOf, cx, inlineMd, parseMinutes } from '@/lib/util'
import { Button, Dot } from './ui'

const timeRange = (s: string, e: string) => `${fmtHM(minutesOfDay(new Date(s)))}–${fmtHM(minutesOfDay(new Date(e)))}`

export function BlockPanel() {
  const { state, selectedBlockId, selectBlock } = useStore()
  if (!state || !selectedBlockId) return null
  const block = state.plan.blocks.find((b) => b.id === selectedBlockId)
  if (block?.kind === 'break')
    return (
      <Shell onClose={() => selectBlock(null)}>
        <div className="text-[15px] font-semibold">{block.title}</div>
        <div className="text-muted text-[12px] mt-1">{timeRange(block.start, block.end)}</div>
        <p className="mt-4 text-[11.5px] text-faint">Protected break. It floats inside its window (Settings → Planning rules) and isn't synced to your calendar.</p>
        <div className="mt-3">
          <Button kind="danger" onClick={() => void act(api.removeBlock(block.id), 'Break removed for this day').then(() => selectBlock(null))}>
            <Trash2 size={13} /> Remove this break today
          </Button>
        </div>
      </Shell>
    )
  if (block) return <BlockDetail key={block.id} block={block} onClose={() => selectBlock(null)} />
  const ev = state.events.find((e) => eventKey(e) === selectedBlockId)
  if (!ev) return null
  return (
    <Shell onClose={() => selectBlock(null)}>
      <div className="text-[15px] font-semibold">{ev.title}</div>
      <div className="text-muted text-[12px] mt-1">
        {new Date(ev.start).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })} · {timeRange(ev.start, ev.end)}
      </div>
      <div className="text-muted text-[12px]">{ev.calendarName}</div>
      {ev.description && (
        <div className="mt-3 text-[12px] whitespace-pre-wrap text-muted" dangerouslySetInnerHTML={{ __html: ev.description.replace(/<(?!\/?(b|i|br|p|ul|li|strong|em)\b)[^>]*>/g, '') }} />
      )}
      <EventAvailability ev={ev} />
    </Shell>
  )
}

const AVAILABILITY_OPTIONS = [
  { value: 'busy', label: 'Busy' },
  { value: 'free', label: 'Free' },
  { value: null, label: 'Calendar default' }
] as const

/** Busy · Free · Calendar default, like Google/Apple's "show as busy/free"; the override lives in Settings, the event is never changed. */
function EventAvailability({ ev }: { ev: CalEvent }) {
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

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <aside className="w-80 shrink-0 border-l border-line bg-panel overflow-y-auto">
      <div className="flex justify-end p-2">
        <Button kind="ghost" onClick={onClose} title="Close">
          <X size={14} />
        </Button>
      </div>
      <div className="px-5 pb-6 -mt-4">{children}</div>
    </aside>
  )
}

function BlockDetail({ block, onClose }: { block: Block; onClose: () => void }) {
  const state = useStore((s) => s.state)!
  const cat = categoryOf(state, block.category)
  const planned = blockMinutes(block)
  const existing = logFor(state, block)
  const tasks = useMemo(
    () => block.chunks.map((c) => ({ chunk: c, task: state.vault.tasks.find((t) => t.id === c.taskId) })).filter((x): x is { chunk: typeof x.chunk; task: Task } => Boolean(x.task)),
    [block, state.vault.tasks]
  )
  const [status, setStatus] = useState<LogStatus>(existing?.status ?? 'done')
  const [actual, setActual] = useState(String(existing?.actualMin ?? planned))
  const [note, setNote] = useState(existing?.note ?? '')
  const [taskState, setTaskState] = useState<Record<string, { done: boolean; remaining: string }>>({})
  const ended = new Date(block.end).getTime() <= Date.now()
  const started = new Date(block.start).getTime() <= Date.now()

  useEffect(() => {
    setTaskState(Object.fromEntries(tasks.map(({ task }) => [task.id, { done: task.done, remaining: task.estimateMin ? String(task.estimateMin) : '' }])))
  }, [tasks])

  const actualMin = parseMinutes(actual)
  const step = (d: number) => setActual(String(Math.max(0, (actualMin ?? planned) + d)))

  const save = async () => {
    if (actualMin === null && status !== 'skipped') return useStore.getState().toast('Enter the time you spent, e.g. 1h20 or 80.', 'error')
    const entry = {
      blockId: block.id,
      date: block.start.slice(0, 10),
      category: block.category,
      title: blockTitle(block),
      start: block.start,
      plannedMin: planned,
      actualMin: status === 'skipped' ? 0 : actualMin!,
      status,
      note: note.trim() || undefined,
      taskIds: tasks.map((t) => t.task.id)
    }
    // Planner-generated blocks are pinned once logged so the record keeps its slot.
    const pin = block.kind === 'container' ? undefined : pinFromBlock(block, block.start, block.end)
    await act(api.logBlock(entry, pin))
    for (const { task } of tasks) {
      const st = taskState[task.id]
      if (!st) continue
      if (st.done && !task.done) await act(api.patchTask(task.id, { done: true }))
      else if (!st.done) {
        const rem = parseMinutes(st.remaining)
        if (rem !== null && rem !== task.estimateMin) await act(api.patchTask(task.id, { estimateMin: rem }))
      }
    }
    useStore.getState().toast(`Logged ${fmtDuration(entry.actualMin)} on ${entry.title}`)
  }

  const accepts = ACCEPTS_TASKS.has(block.kind) && !existing && !ended
  const removable = REMOVABLE.has(block.kind)
  const removeBlock = async () => {
    const snapshot = block
    const ok = await act(api.removeBlock(block.id).then(() => true))
    if (!ok) return
    onClose()
    useStore.getState().toast(block.kind === 'container' ? 'Calendar event no longer used for tasks' : 'Block removed; its tasks are planned elsewhere', 'info', {
      label: 'Undo',
      run: () => void act(api.restoreBlock(snapshot), 'Block restored')
    })
  }
  const removeTask = (taskId: string) => act(api.removeTaskFromBlock(block.id, taskId), 'Removed from this block')

  // Delete/Backspace removes the selected block, unless the user is typing somewhere.
  useEffect(() => {
    if (!removable) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      e.preventDefault()
      void removeBlock()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, block.kind, removable])

  const togglePin = async () => {
    if (block.pinned) await act(api.unpin(block.id), 'Unpinned: the planner may move it again')
    else await act(api.pin(pinFromBlock(block, block.start, block.end)), 'Pinned in place')
  }

  return (
    <Shell onClose={onClose}>
      <div className="flex items-center gap-2 text-[11.5px] text-muted">
        <Dot color={cat.color} /> {cat.label}
        <span>·</span>
        <span>{block.calendarName}</span>
      </div>
      <div className="text-[15px] font-semibold mt-1">{blockTitle(block)}</div>
      <div className="text-muted text-[12px] mt-0.5">
        {new Date(block.start).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })} · {timeRange(block.start, block.end)} ·{' '}
        {fmtDuration(planned)}
      </div>
      <div className="text-[11.5px] text-faint mt-1">
        {block.kind === 'container' && 'Existing calendar block, filled by the planner'}
        {block.kind === 'proposed' && (isSynced(state, block) ? 'Planned · synced to calendar' : 'Planned · not yet synced')}
        {block.kind === 'topup' && 'Reserved to reach the weekly budget'}
        {block.kind === 'training' && `Training session from your plan${isSynced(state, block) ? ' · synced' : ''}`}
        {block.kind === 'pinned' && 'Pinned: stays where you put it'}
      </div>

      {block.kind !== 'container' && (
        <div className="mt-3">
          <Button onClick={togglePin}>
            {block.pinned ? <PinOff size={13} /> : <Pin size={13} />} {block.pinned ? 'Unpin' : 'Pin here'}
          </Button>
        </div>
      )}

      {(tasks.length > 0 || accepts) && (
        <section className="mt-5">
          <h3 className="text-[11px] uppercase tracking-wide text-faint mb-2">Tasks in this block</h3>
          <div className="flex flex-col gap-2">
            {tasks.map(({ task, chunk }) => {
              const st = taskState[task.id] ?? { done: task.done, remaining: '' }
              return (
                <div key={task.id} className="flex items-start gap-2">
                  <button
                    onClick={() => setTaskState({ ...taskState, [task.id]: { ...st, done: !st.done } })}
                    className={cx('mt-0.5 w-4 h-4 rounded border grid place-items-center shrink-0', st.done ? 'bg-accent border-accent text-white' : 'border-faint')}
                  >
                    {st.done && <Check size={11} strokeWidth={3} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={cx('text-[12.5px]', st.done && 'line-through text-muted')} dangerouslySetInnerHTML={{ __html: inlineMd(task.title) }} />
                    <div className="text-[11px] text-faint">{fmtDuration(chunk.minutes)} planned here</div>
                    {!st.done && started && (
                      <label className="flex items-center gap-1.5 mt-1 text-[11px] text-muted">
                        Still needs
                        <input
                          value={st.remaining}
                          onChange={(e) => setTaskState({ ...taskState, [task.id]: { ...st, remaining: e.target.value } })}
                          placeholder="e.g. 1h"
                          className="w-16 px-1.5 py-0.5 rounded border border-line bg-bg text-ink"
                        />
                      </label>
                    )}
                  </div>
                  {ACCEPTS_TASKS.has(block.kind) && !existing && (
                    <button onClick={() => removeTask(task.id)} title="Take out of this block (planned elsewhere)" className="mt-0.5 text-faint hover:text-danger shrink-0">
                      <X size={13} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          {accepts && <AddTask block={block} />}
        </section>
      )}

      {removable && (
        <section className="mt-5">
          <Button kind="danger" onClick={removeBlock} title="Delete / Backspace">
            <Trash2 size={13} /> Remove block
          </Button>
          <p className="mt-1.5 text-[11px] text-faint">
            {block.kind === 'container'
              ? 'Stop using this calendar event for tasks (the event itself stays).'
              : 'Remove this block; its tasks are planned elsewhere. If it was synced, the next Sync removes it from your calendar.'}
          </p>
        </section>
      )}

      <section className="mt-6 border-t border-line pt-4">
        <h3 className="text-[11px] uppercase tracking-wide text-faint mb-2">{existing ? 'Logged' : ended ? 'Log this block' : started ? 'Log (in progress)' : 'Log time'}</h3>
        <div className="flex gap-1 mb-3">
          {(['done', 'partial', 'skipped'] as LogStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cx('flex-1 h-7 rounded-md border text-[12px] capitalize', status === s ? 'bg-accent text-white border-accent' : 'border-line hover:bg-sunken')}
            >
              {s}
            </button>
          ))}
        </div>
        {status !== 'skipped' && (
          <>
            <div className="text-[11.5px] text-muted mb-1">Time actually spent</div>
            <div className="flex items-center gap-1">
              <Button onClick={() => step(-15)} title="−15 min">
                <Minus size={13} />
              </Button>
              <input
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                className="w-20 h-7 text-center rounded-md border border-line bg-bg text-[13px] font-medium"
              />
              <Button onClick={() => step(15)} title="+15 min">
                <Plus size={13} />
              </Button>
              <span className="text-[11.5px] text-muted ml-1">
                {actualMin !== null ? fmtDuration(actualMin) : '?'}
                {actualMin !== null && actualMin !== planned && (
                  <span className={actualMin > planned ? 'text-ok' : 'text-warn'}> ({actualMin > planned ? '+' : ''}{fmtDuration(actualMin - planned)})</span>
                )}
              </span>
            </div>
            <div className="flex gap-1 mt-2">
              {[0.5, 0.75, 1, 1.25, 1.5].map((f) => (
                <button key={f} onClick={() => setActual(String(Math.round((planned * f) / 5) * 5))} className="px-1.5 h-6 rounded border border-line text-[11px] text-muted hover:bg-sunken">
                  {fmtDuration(Math.round((planned * f) / 5) * 5)}
                </button>
              ))}
            </div>
          </>
        )}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          rows={2}
          className="mt-3 w-full px-2 py-1.5 rounded-md border border-line bg-bg text-[12.5px] resize-none"
        />
        <div className="flex gap-2 mt-2">
          <Button kind="primary" onClick={save}>
            {existing ? 'Update log' : 'Save log'}
          </Button>
          {existing && (
            <Button kind="ghost" onClick={() => act(api.unlog(block.id, block.start), 'Log removed')}>
              Remove log
            </Button>
          )}
        </div>
      </section>
    </Shell>
  )
}

/** Searchable picker: open leaf tasks not already here, the block's own area first. */
function AddTask({ block }: { block: Block }) {
  const state = useStore((s) => s.state)!
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const options = useMemo(() => {
    const tasks = state.vault.tasks
    const openIds = new Set(tasks.filter((t) => !t.done).map((t) => t.id))
    const here = new Set(block.chunks.map((c) => c.taskId))
    const needle = q.trim().toLowerCase()
    return tasks
      .filter((t) => !t.done && !here.has(t.id) && !t.childIds.some((id) => openIds.has(id)))
      .filter((t) => !needle || t.title.toLowerCase().includes(needle) || t.section.join(' ').toLowerCase().includes(needle))
      .sort((a, b) => Number(b.category === block.category) - Number(a.category === block.category))
      .slice(0, 40)
  }, [state.vault.tasks, block, q])

  if (!open)
    return (
      <Button kind="ghost" className="mt-2 -ml-2" onClick={() => setOpen(true)}>
        <Plus size={13} /> Add task…
      </Button>
    )
  const add = async (t: Task) => {
    setOpen(false)
    setQ('')
    await act(api.addTaskToBlock(block.id, t.id), 'Added to block')
  }
  return (
    <div className="mt-2 rounded-md border border-line bg-bg">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
          if (e.key === 'Enter' && options[0]) void add(options[0])
        }}
        placeholder="Search tasks…"
        className="w-full h-7 px-2 bg-transparent border-b border-line text-[12.5px] outline-none placeholder:text-faint"
      />
      <div className="max-h-56 overflow-y-auto py-1">
        {options.map((t) => (
          <button key={t.id} onClick={() => add(t)} className="w-full text-left px-2 py-1 hover:bg-sunken flex items-start gap-1.5">
            <Dot color={categoryOf(state, t.category).color} className="mt-1" />
            <span className="flex-1 min-w-0">
              <span className="block text-[12px] truncate" dangerouslySetInnerHTML={{ __html: inlineMd(t.title) }} />
              {t.section.length > 0 && <span className="block text-[10.5px] text-faint truncate">{t.section.join(' › ')}</span>}
            </span>
          </button>
        ))}
        {!options.length && <div className="px-2 py-1 text-[11.5px] text-faint">No matching open tasks.</div>}
      </div>
    </div>
  )
}
