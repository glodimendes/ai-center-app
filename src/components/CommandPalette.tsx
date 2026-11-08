import { useEffect, useMemo, useState } from 'react'
import { CornerDownLeft } from 'lucide-react'
import type { DocInfo } from '@shared/types'
import { api } from '@/lib/api'
import { act, useStore, type View } from '@/store/app'
import { cx, plainTitle } from '@/lib/util'
import { Modal } from './ui'

interface Cmd {
  id: string
  label: string
  hint?: string
  run: () => void
}

export function CommandPalette({ onClose, onUpdateContext }: { onClose: () => void; onUpdateContext: () => void }) {
  const { state, go, openDoc } = useStore()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [docs, setDocs] = useState<DocInfo[]>([])

  useEffect(() => {
    void api.listDocs().then(setDocs)
  }, [])

  const cmds = useMemo<Cmd[]>(() => {
    const views: [View, string][] = [
      ['brief', 'Go to Brief'],
      ['today', 'Go to Today'],
      ['week', 'Go to Week'],
      ['tasks', 'Go to Tasks'],
      ['inbox', 'Go to Inbox'],
      ['docs', 'Go to Docs'],
      ['review', 'Weekly review'],
      ['settings', 'Settings']
    ]
    const out: Cmd[] = views.map(([v, label]) => ({ id: v, label, run: () => go(v) }))
    if (q.trim()) out.unshift({ id: 'capture', label: `Capture “${q.trim()}” to inbox`, run: () => void act(api.addInbox(q.trim()), 'Captured') })
    out.unshift({ id: 'context', label: 'Update context…', hint: '⌘U', run: onUpdateContext })
    out.push({ id: 'refresh', label: 'Refresh calendar', run: () => void act(api.refreshCalendar(), 'Calendar refreshed') })
    for (const d of docs) out.push({ id: 'doc:' + d.path, label: d.title, hint: d.group, run: () => openDoc(d.path) })
    for (const t of state?.vault.tasks.filter((t) => !t.done) ?? [])
      out.push({ id: 'task:' + t.id, label: plainTitle(t), hint: t.section.join(' › '), run: () => go('tasks') })
    return out
  }, [q, docs, state, go, openDoc, onUpdateContext])

  const shown = cmds.filter((c) => c.id === 'capture' || !q || c.label.toLowerCase().includes(q.toLowerCase()) || c.hint?.toLowerCase().includes(q.toLowerCase())).slice(0, 12)

  return (
    <Modal onClose={onClose}>
      <input
        autoFocus
        value={q}
        onChange={(e) => (setQ(e.target.value), setIdx(0))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setIdx(Math.min(idx + 1, shown.length - 1)))
          if (e.key === 'ArrowUp') (e.preventDefault(), setIdx(Math.max(idx - 1, 0)))
          if (e.key === 'Enter' && shown[idx]) {
            shown[idx].run()
            onClose()
          }
        }}
        placeholder="Search views, docs, tasks, or type to capture…"
        className="w-full h-12 px-4 bg-transparent outline-none text-[14px] border-b border-line"
      />
      <div className="p-1.5 max-h-80 overflow-y-auto">
        {shown.map((c, i) => (
          <button
            key={c.id}
            onMouseEnter={() => setIdx(i)}
            onClick={() => (c.run(), onClose())}
            className={cx('w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left text-[13px]', i === idx && 'bg-accent-soft')}
          >
            <span className="flex-1 truncate">{c.label}</span>
            {c.hint && <span className="text-[11px] text-faint truncate max-w-48">{c.hint}</span>}
            {i === idx && <CornerDownLeft size={12} className="text-faint" />}
          </button>
        ))}
      </div>
    </Modal>
  )
}
