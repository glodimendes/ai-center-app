import { useEffect, useMemo, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import type { Block, Task } from '@shared/types'
import { fmtDuration, fmtHM, localISO } from '@shared/time'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { blockMinutes, pinFromBlock } from '@/lib/plan'
import { categoryOf, inlineMd, parseMinutes } from '@/lib/util'
import { Button, Dot, MoonZzz, Popover } from '../ui'
import { inDays, postponeChoices } from '../TaskRow'

export function PostponeBlock({ block }: { block: Block }) {
  const [open, setOpen] = useState(false)
  const go = (until: string | null) => {
    setOpen(false)
    void act(api.postponeBlock(block.id, until), until ? `Tasks postponed to ${until}` : 'No longer postponed')
  }
  return (
    <div className="relative mt-2">
      <Button onClick={() => setOpen(!open)} title="Postpone all tasks in this block">
        <MoonZzz size={13} /> Postpone tasks
      </Button>
      {open && (
        <Popover onClose={() => setOpen(false)} className="w-52">
          <div className="text-[11px] text-muted mb-1.5">Postpone every task here until</div>
          <div className="grid grid-cols-2 gap-1 mb-2">
            {postponeChoices().map(([label, days]) => (
              <button key={label} onClick={() => go(inDays(days))} className="h-6 rounded border border-line text-[11px] hover:bg-sunken">
                {label}
              </button>
            ))}
          </div>
          <input type="date" min={inDays(1)} onChange={(e) => e.target.value && go(e.target.value)} className="w-full px-2 h-7 rounded border border-line bg-bg text-[12px]" />
          <p className="text-[10.5px] text-faint mt-1.5">They leave this block and aren't planned before that date.</p>
        </Popover>
      )}
    </div>
  )
}

/** Change the block's length (end moves; the block is pinned like after a drag). Also: drag its bottom edge. */
export function Duration({ block }: { block: Block }) {
  const minutes = blockMinutes(block)
  const [text, setText] = useState(fmtHM(minutes))
  useEffect(() => setText(fmtHM(minutes)), [minutes])
  const set = (m: number | null) => {
    if (m === null || m < 15) return setText(fmtHM(minutes))
    const len = Math.round(m / 15) * 15
    if (len === minutes) return setText(fmtHM(minutes))
    const end = localISO(new Date(new Date(block.start).getTime() + len * 60_000))
    void act(api.pin(pinFromBlock(block, block.start, end)), `Now ${fmtDuration(len)}`)
  }
  return (
    <div className="flex items-center gap-1" title="Duration (hh:mm)">
      <Button onClick={() => set(minutes - 15)} title="−15 min">
        <Minus size={13} />
      </Button>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => set(parseMinutes(text))}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="w-14 h-7 text-center rounded-md border border-line bg-bg text-[12.5px] font-medium"
      />
      <Button onClick={() => set(minutes + 15)} title="+15 min">
        <Plus size={13} />
      </Button>
    </div>
  )
}

/** Searchable picker: open leaf tasks not already here, the block's own area first. */
export function AddTask({ block }: { block: Block }) {
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
