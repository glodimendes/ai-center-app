import { useEffect, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import type { EstimateSuggestion } from '@shared/api'
import { fmtDuration } from '@shared/time'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { categoryOf, cx, inlineMd } from '@/lib/util'
import { Button, Dot, Modal } from './ui'

/** Claude Haiku suggests estimates for tasks without one; the user ticks what to keep. */
export function EstimateSuggestions({ onClose }: { onClose: () => void }) {
  const s = useStore((st) => st.state)!
  const [rows, setRows] = useState<(EstimateSuggestion & { on: boolean })[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.suggestEstimates().then(
      (r) => setRows(r.map((x) => ({ ...x, on: true }))),
      (e) => setError((e as Error).message)
    )
  }, [])

  const chosen = rows?.filter((r) => r.on) ?? []
  const apply = async () => {
    await act(api.applyEstimates(Object.fromEntries(chosen.map((r) => [r.taskId, r.minutes]))), `${chosen.length} estimate${chosen.length === 1 ? '' : 's'} added`)
    onClose()
  }
  const set = (id: string, patch: Partial<EstimateSuggestion & { on: boolean }>) => setRows((rs) => rs!.map((r) => (r.taskId === id ? { ...r, ...patch } : r)))

  return (
    <Modal onClose={onClose} width="max-w-2xl">
      <div className="p-5 flex flex-col gap-3 text-[12.5px]">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-accent" />
          <div className="text-[15px] font-semibold">Suggested estimates</div>
        </div>
        <p className="text-muted">
          Claude Haiku (no access to anything; it only sees these task titles and your existing estimates) suggests how long each task without a <code>~</code> estimate takes. Nothing is written
          until you apply; untick or change any.
        </p>
        {error && <div className="rounded-md bg-warn-soft text-warn px-3 py-2">{error}</div>}
        {!rows && !error && (
          <div className="py-10 grid place-items-center text-muted gap-2">
            <Loader2 size={18} className="animate-spin" />
            Asking Claude Haiku…
          </div>
        )}
        {rows && !rows.length && <p className="text-faint py-4">Every open task already has an estimate.</p>}
        {rows && rows.length > 0 && (
          <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1 flex flex-col divide-y divide-line/60">
            {rows.map((r) => (
              <label key={r.taskId} className={cx('flex items-center gap-2 py-1.5', !r.on && 'opacity-50')}>
                <input type="checkbox" checked={r.on} onChange={(e) => set(r.taskId, { on: e.target.checked })} />
                <Dot color={categoryOf(s, r.category).color} />
                <span className="flex-1 min-w-0">
                  <span className="block truncate" dangerouslySetInnerHTML={{ __html: inlineMd(r.title) }} />
                  <span className="block text-[11px] text-faint truncate">{r.why || r.section.join(' › ')}</span>
                </span>
                <input
                  type="number"
                  min={15}
                  step={15}
                  value={r.minutes}
                  onChange={(e) => set(r.taskId, { minutes: Math.max(15, Number(e.target.value) || 15) })}
                  className="w-16 h-7 px-1.5 rounded border border-line bg-bg text-right"
                />
                <span className="w-14 text-faint whitespace-nowrap">{fmtDuration(r.minutes)}</span>
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!chosen.length} onClick={() => void apply()}>
            Add {chosen.length} estimate{chosen.length === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
