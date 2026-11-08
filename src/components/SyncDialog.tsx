import { useEffect, useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import type { SyncOp } from '@shared/types'
import { fmtHM, minutesOfDay } from '@shared/time'
import { api } from '@/lib/api'
import { useStore } from '@/store/app'
import { cx } from '@/lib/util'
import { Button, Modal } from './ui'

const when = (s: string, e: string) =>
  `${new Date(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtHM(minutesOfDay(new Date(s)))}–${fmtHM(minutesOfDay(new Date(e)))}`

/** Shows exactly what will change in Google Calendar; nothing is sent until confirmed. */
export function SyncDialog({ onClose }: { onClose: () => void }) {
  const toast = useStore((s) => s.toast)
  const [ops, setOps] = useState<SyncOp[] | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.syncPreview().then(
      (r) => {
        setOps(r.ops)
        setProblems(r.problems)
        setSelected(new Set(r.ops.map((_, i) => i)))
      },
      (e) => setError(e.message)
    )
  }, [])

  const apply = async () => {
    if (!ops) return
    setBusy(true)
    const chosen = ops.filter((_, i) => selected.has(i))
    try {
      const r = await api.syncApply(chosen)
      if (r.failed.length) toast(`Synced ${r.done}, ${r.failed.length} failed: ${r.failed[0]}`, 'error')
      else toast(`Synced ${r.done} change${r.done === 1 ? '' : 's'} to Google Calendar`)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const byCal = new Map<string, number[]>()
  ops?.forEach((o, i) => byCal.set(o.calendarName, [...(byCal.get(o.calendarName) ?? []), i]))

  return (
    <Modal onClose={onClose} width="max-w-2xl">
      <div className="p-5 border-b border-line">
        <h2 className="text-[15px] font-semibold">Sync to Google Calendar</h2>
        <p className="text-[12px] text-muted mt-0.5">
          Only events created by the planner are changed. Your own and Codex's events are never touched. Untick anything you don't want sent.
        </p>
      </div>
      <div className="max-h-[50vh] overflow-y-auto p-5">
        {error && <div className="text-danger text-[12.5px]">{error}</div>}
        {!ops && !error && (
          <div className="flex items-center gap-2 text-muted text-[12.5px]">
            <Loader2 size={14} className="animate-spin" /> Comparing with your calendar…
          </div>
        )}
        {problems.map((p, i) => (
          <div key={i} className="text-warn text-[12px] mb-2">
            {p}
          </div>
        ))}
        {ops && ops.length === 0 && <div className="text-muted text-[12.5px]">Everything is already in sync.</div>}
        {[...byCal].map(([cal, idx]) => (
          <div key={cal} className="mb-4">
            <h3 className="text-[11px] uppercase tracking-wide text-faint mb-1.5">{cal}</h3>
            {idx.map((i) => {
              const o = ops![i]
              return (
                <label key={i} className="flex items-center gap-2.5 py-1 text-[12.5px]">
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={() => {
                      const n = new Set(selected)
                      if (n.has(i)) n.delete(i)
                      else n.add(i)
                      setSelected(n)
                    }}
                  />
                  <span
                    className={cx(
                      'w-14 text-[10.5px] font-semibold uppercase',
                      o.op === 'create' && 'text-ok',
                      o.op === 'update' && 'text-accent',
                      o.op === 'delete' && 'text-danger'
                    )}
                  >
                    {o.op === 'create' ? 'Add' : o.op === 'update' ? 'Move' : 'Remove'}
                  </span>
                  <span className="font-medium flex-1 truncate">{o.title}</span>
                  <span className="text-muted text-[11.5px] flex items-center gap-1">
                    {o.previous && (
                      <>
                        <span className="line-through">{when(o.previous.start, o.previous.end)}</span>
                        <ArrowRight size={11} />
                      </>
                    )}
                    {when(o.start, o.end)}
                  </span>
                </label>
              )
            })}
          </div>
        ))}
      </div>
      <div className="p-4 border-t border-line flex justify-end gap-2">
        <Button kind="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button kind="primary" onClick={apply} disabled={busy || !ops || selected.size === 0}>
          {busy && <Loader2 size={13} className="animate-spin" />} Send {selected.size} change{selected.size === 1 ? '' : 's'}
        </Button>
      </div>
    </Modal>
  )
}
