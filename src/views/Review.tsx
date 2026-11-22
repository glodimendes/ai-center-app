import { useState } from 'react'
import { ChevronLeft, ChevronRight, ClipboardCheck } from 'lucide-react'
import { addDays, fmtDuration, isoDate, isoWeek, parseDate, weekStart } from '@shared/time'
import { useStore } from '@/store/app'
import { categoryOf, cx, inlineMd } from '@/lib/util'
import { BudgetBars } from '@/components/BudgetBars'
import { PrioritiesPanel } from '@/components/PrioritiesPanel'
import { Button, Dot, Header } from '@/components/ui'
import { DueList } from '@/components/DueList'
import { WeeklyReview } from '@/components/WeeklyReview'

export function Review() {
  const { state, day, setDay } = useStore()
  const s = state!
  const [reviewing, setReviewing] = useState(false)
  const start = weekStart(parseDate(day))
  const week = isoWeek(start)
  const log = [...(s.vault.weeks[week]?.log ?? [])].sort((a, b) => a.start.localeCompare(b.start))
  const actual = log.reduce((a, l) => a + l.actualMin, 0)
  const planned = log.reduce((a, l) => a + l.plannedMin, 0)
  const skipped = log.filter((l) => l.status === 'skipped').length
  const weekEnd = isoDate(addDays(start, 6))
  const slipped = s.vault.tasks.filter((t) => !t.done && t.due && !t.dueFromParent && t.due <= weekEnd)
  const doneThisWeek = log.flatMap((l) => l.taskIds ?? []).map((id) => s.vault.tasks.find((t) => t.id === id)).filter((t) => t?.done)

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Header title={`Weekly review · ${week}`} sub="The week against the plan">
        <Button kind="primary" onClick={() => setReviewing(true)} label="Review & plan the week" title="Guided weekly review: last week, tidy, focus, hours, re-plan and sync">
          <ClipboardCheck size={13} />
        </Button>
        <Button onClick={() => setDay(isoDate(addDays(start, -7)))}>
          <ChevronLeft size={14} />
        </Button>
        <Button onClick={() => setDay(isoDate(new Date()))} title="This week">
          <span className="@max-3xl:hidden">This week</span>
          <span className="@3xl:hidden">Now</span>
        </Button>
        <Button onClick={() => setDay(isoDate(addDays(start, 7)))}>
          <ChevronRight size={14} />
        </Button>
      </Header>
      <div className="flex-1 min-h-0 flex @max-5xl:flex-col @max-5xl:overflow-y-auto">
        <div className="flex-1 overflow-y-auto px-6 @max-3xl:px-4 py-5 min-w-0 @max-5xl:flex-none @max-5xl:overflow-visible">
          <div className="grid grid-cols-3 @max-3xl:grid-cols-2 gap-3 mb-6">
            <Stat label="Time logged" value={fmtDuration(actual)} note={`of ${fmtDuration(planned)} planned`} />
            <Stat label="Against plan" value={`${actual >= planned ? '+' : ''}${fmtDuration(actual - planned)}`} tone={actual >= planned ? 'ok' : 'warn'} />
            {skipped > 0 && <Stat label="Blocks skipped" value={String(skipped)} tone="warn" />}
          </div>

          <h2 className="text-[14px] font-semibold mb-3">Budgets</h2>
          <BudgetBars week={week} wide />

          <h2 className="text-[13px] font-semibold mt-9 mb-2">Logged blocks</h2>
          {!log.length && <p className="text-[12.5px] text-faint">Nothing logged yet. Click a block in Today or Week to log your time.</p>}
          <div className="flex flex-col">
            {log.map((l) => (
              <div key={l.blockId} className="flex items-center gap-3 py-2 border-b border-line/40 text-[12.5px]">
                <span className="w-24 shrink-0 whitespace-nowrap text-muted">
                  {parseDate(l.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })} {l.start.slice(11, 16)}
                </span>
                <Dot color={categoryOf(s, l.category).color} />
                <span className="flex-1 min-w-0 truncate">
                  {l.title}
                  {l.note && <span className="text-muted">: {l.note}</span>}
                </span>
                <span className={cx('w-16 shrink-0 text-right text-[12px] @max-xl:hidden', l.status === 'skipped' ? 'text-warn' : 'text-muted')}>{l.status}</span>
                <span className="shrink-0 whitespace-nowrap text-right">
                  {fmtDuration(l.actualMin)} <span className="text-faint">/ {fmtDuration(l.plannedMin)}</span>
                </span>
              </div>
            ))}
          </div>

          {doneThisWeek.length > 0 && (
            <>
              <h2 className="text-[14px] font-semibold mt-9 mb-2">Finished in logged blocks</h2>
              {doneThisWeek.map((t) => (
                <div key={t!.id} className="text-[12.5px] py-0.5 text-muted" dangerouslySetInnerHTML={{ __html: '✓ ' + inlineMd(t!.title) }} />
              ))}
            </>
          )}

          <h2 className="text-[14px] font-semibold mt-9 mb-3">Due by the end of the week</h2>
          <DueList tasks={slipped} />
        </div>
        <div className="w-[380px] shrink-0 border-l border-line/50 flex flex-col min-h-0 bg-panel @max-5xl:w-auto @max-5xl:min-h-[480px] @max-5xl:border-l-0 @max-5xl:border-t border-line/50">
          <PrioritiesPanel />
        </div>
      </div>
      {reviewing && <WeeklyReview onClose={() => setReviewing(false)} />}
    </div>
  )
}

function Stat({ label, value, tone, note }: { label: string; value: string; tone?: 'ok' | 'warn'; note?: string }) {
  return (
    <div className="rounded-xl border border-line/60 bg-panel px-4 py-3.5 min-w-0">
      <div className="text-[11px] text-muted truncate" title={label}>{label}</div>
      <div className={cx('text-[20px] font-semibold mt-0.5 truncate', tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn')}>{value}</div>
      {note && <div className="text-[11px] text-faint truncate">{note}</div>}
    </div>
  )
}
