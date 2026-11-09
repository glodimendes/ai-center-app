import { useState } from 'react'
import { Plus } from 'lucide-react'
import { fmtHM, isoDate, minutesOfDay, toHM } from '@shared/time'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { Button, Dot, Modal } from './ui'
import { NO_AREA, noAreaCategory } from '@shared/categories'

export interface BlockDraft {
  start: string
  end: string
}

const input = 'h-7 px-2 rounded-md border border-line bg-bg text-[12.5px] outline-none focus:border-accent'

/** A block you place yourself: pinned where you put it, optionally filled with the area's tasks. */
export function NewBlockDialog({ draft, onClose }: { draft: BlockDraft; onClose: () => void }) {
  const state = useStore((s) => s.state)!
  const selectBlock = useStore((s) => s.selectBlock)
  const areas = [...state.vault.preferences.categories.filter((c) => c.key !== 'other'), noAreaCategory(state.vault.preferences.categories)]
  const [area, setArea] = useState(areas[0]?.key ?? NO_AREA)
  const none = area === NO_AREA
  const cat = areas.find((c) => c.key === area)
  const defaultTitle = (key: string) => {
    if (key === NO_AREA) return ''
    const c = areas.find((x) => x.key === key)
    return c ? (c.containers[0] ?? c.label) : 'Block'
  }
  const [title, setTitle] = useState(defaultTitle(area))
  const [titleEdited, setTitleEdited] = useState(false)
  const [day, setDay] = useState(draft.start.slice(0, 10))
  const [from, setFrom] = useState(fmtHM(minutesOfDay(new Date(draft.start))))
  const [to, setTo] = useState(fmtHM(minutesOfDay(new Date(draft.end)) || 24 * 60 - 15))
  const [fill, setFill] = useState(true)
  const valid = Boolean(day && from && to && toHM(to) > toHM(from))

  const create = async () => {
    if (!valid) return
    const blockId = `pin:${Date.now().toString(36)}`
    const ok = await act(
      api.pin({ blockId, category: area, title: title.trim() || defaultTitle(area) || 'Block', start: `${day}T${from}:00`, end: `${day}T${to}:00`, taskIds: [], ...(fill && !none ? { fill: true } : {}) }).then(() => true),
      'Block added'
    )
    if (!ok) return
    onClose()
    selectBlock(blockId)
  }

  return (
    <Modal onClose={onClose} width="max-w-sm">
      <form
        className="p-5 flex flex-col gap-3 text-[12.5px]"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <div className="text-[15px] font-semibold">New block</div>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Area</span>
          <div className="flex flex-wrap gap-1">
            {areas.map((c) => (
              <button
                type="button"
                key={c.key}
                onClick={() => {
                  setArea(c.key)
                  if (!titleEdited) setTitle(defaultTitle(c.key))
                }}
                className={`flex items-center gap-1.5 px-2 h-6 rounded-full border text-[11.5px] ${area === c.key ? 'border-accent bg-accent-soft' : 'border-line text-muted hover:bg-sunken'}`}
              >
                <Dot color={c.color} /> {c.label}
              </button>
            ))}
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Title</span>
          <input
            autoFocus
            className={input}
            value={title}
            placeholder={none ? 'e.g. Doctor, Errands, Call with mom' : undefined}
            onChange={(e) => {
              setTitle(e.target.value)
              setTitleEdited(true)
            }}
          />
        </label>
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-muted">Day</span>
            <input type="date" className={input} value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">From</span>
            <input type="time" step={900} className={input} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">To</span>
            <input type="time" step={900} className={input} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        {none ? (
          <p className="text-[11px] text-faint">Holds the time without an area: not filled with tasks and not counted as work. Synced to {cat?.calendar}.</p>
        ) : (
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={fill} onChange={(e) => setFill(e.target.checked)} />
            <span>
              Fill with {cat?.label ?? 'this area'}'s tasks automatically
              <span className="block text-[11px] text-faint">Off: it stays empty until you add tasks to it.</span>
            </span>
          </label>
        )}
        <div className="flex gap-2 justify-end mt-1">
          <Button kind="ghost" onClick={onClose}>
            Cancel
          </Button>
          <button type="submit" disabled={!valid} className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[12.5px] font-medium bg-accent text-white hover:opacity-90 disabled:opacity-40">
            Add block
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** "+ Block" in a calendar header: next full hour on the given day (or 09:00 on other days), one hour long. */
export function AddBlockButton({ day, onOpen }: { day: string; onOpen: (d: BlockDraft) => void }) {
  const open = () => {
    const now = new Date()
    const startMin = day === isoDate(now) ? Math.min(23 * 60 - 15, (now.getHours() + 1) * 60) : 9 * 60
    onOpen({ start: `${day}T${fmtHM(startMin)}:00`, end: `${day}T${fmtHM(startMin + 60)}:00` })
  }
  return (
    <Button onClick={open} title="Add a block (or drag on empty time in the calendar)">
      <Plus size={13} /> Block
    </Button>
  )
}
