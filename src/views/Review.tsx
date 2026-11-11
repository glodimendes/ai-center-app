import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays, fmtDuration, isoDate, isoWeek, parseDate, weekStart } from '@shared/time'
import { useStore } from '@/store/app'
import { categoryOf, cx, inlineMd } from '@/lib/util'
import { BudgetBars } from '@/components/BudgetBars'
import { DocEditor } from '@/components/DocEditor'
import { Button, Dot, Empty, Header } from '@/components/ui'

export function Review() {
  const { state, day, setDay } = useStore()
  const s = state!
  const start = weekStart(parseDate(day))
  const week = isoWeek(start)
  const log = [...(s.vault.weeks[week]?.log ?? [])].sort((a, b) => a.start.localeCompare(b.start))
  const actual = log.reduce((a, l) => a + l.actualMin, 0)
  const planned = log.reduce((a, l) => a + l.plannedMin, 0)
  const skipped = log.filter((l) => l.status === 'skipped').length
  const weekEnd = isoDate(addDays(start, 6))
  const slipped = s.vault.tasks.filter((t) => !t.done && t.due && t.due <= weekEnd)
  const doneThisWeek = log.flatMap((l) => l.taskIds ?? []).map((id) => s.vault.tasks.find((t) => t.id === id)).filter((t) => t?.done)

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Header title={`Weekly review · ${week}`} sub="How the week went, compared with the plan. Adjust priorities on the right.">
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
          <div className="grid grid-cols-4 @max-3xl:grid-cols-2 gap-3 mb-6">
            <Stat label="Time logged" value={fmtDuration(actual)} />
            <Stat label="Planned (logged blocks)" value={fmtDuration(planned)} />
            <Stat label="Difference" value={`${actual >= planned ? '+' : ''}${fmtDuration(actual - planned)}`} tone={actual >= planned ? 'ok' : 'warn'} />
            <Stat label="Blocks skipped" value={String(skipped)} tone={skipped ? 'warn' : undefined} />
          </div>

          <h2 className="text-[13px] font-semibold mb-3">Budgets</h2>
          <BudgetBars week={week} wide />

          <h2 className="text-[13px] font-semibold mt-8 mb-2">Logged blocks</h2>
          {!log.length && <Empty>Nothing logged this week yet. Click a block in Today or Week to log your time.</Empty>}
          <div className="flex flex-col">
            {log.map((l) => (
              <div key={l.blockId} className="flex items-center gap-3 py-1.5 border-b border-line/60 text-[12.5px]">
                <span className="w-24 shrink-0 whitespace-nowrap text-muted">
                  {parseDate(l.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })} {l.start.slice(11, 16)}
                </span>
                <Dot color={categoryOf(s, l.category).color} />
                <span className="flex-1 min-w-0 truncate">
                  {l.title}
                  {l.note && <span className="text-muted">: {l.note}</span>}
                </span>
                <span className={cx('w-16 shrink-0 text-right text-[11px] uppercase @max-xl:hidden', l.status === 'skipped' ? 'text-warn' : 'text-muted')}>{l.status}</span>
                <span className="shrink-0 whitespace-nowrap text-right">
                  {fmtDuration(l.actualMin)} <span className="text-faint">/ {fmtDuration(l.plannedMin)}</span>
                </span>
              </div>
            ))}
          </div>

          {doneThisWeek.length > 0 && (
            <>
              <h2 className="text-[13px] font-semibold mt-8 mb-2">Finished in logged blocks</h2>
              {doneThisWeek.map((t) => (
                <div key={t!.id} className="text-[12.5px] py-0.5 text-muted" dangerouslySetInnerHTML={{ __html: '✓ ' + inlineMd(t!.title) }} />
              ))}
            </>
          )}

          <h2 className="text-[13px] font-semibold mt-8 mb-2">Due by end of week, still open</h2>
          {!slipped.length && <Empty>Nothing slipped.</Empty>}
          {slipped.map((t) => (
            <div key={t.id} className="flex flex-wrap gap-x-2 text-[12.5px] py-0.5">
              <span className={cx('w-20 shrink-0', t.due! < isoDate(new Date()) ? 'text-danger' : 'text-muted')}>{t.due}</span>
              <span className="min-w-0 break-words" dangerouslySetInnerHTML={{ __html: inlineMd(t.title) }} />
              <span className="text-faint text-[11px]">{t.section.join(' › ')}</span>
            </div>
          ))}
        </div>
        <div className="w-[460px] shrink-0 border-l border-line flex flex-col min-h-0 bg-panel @max-5xl:w-auto @max-5xl:min-h-[480px] @max-5xl:border-l-0 @max-5xl:border-t">
          <div className="px-5 pt-3 pb-1 text-[11px] uppercase tracking-wide text-faint">Current priorities</div>
          <DocEditor path="04_Context_Docs/current-priorities.md" />
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3 min-w-0">
      <div className="text-[11px] text-muted truncate" title={label}>{label}</div>
      <div className={cx('text-[20px] font-semibold mt-0.5 truncate', tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn')}>{value}</div>
    </div>
  )
}
