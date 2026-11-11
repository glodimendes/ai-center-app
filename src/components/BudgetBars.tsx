import { fmtDuration, isoWeek } from '@shared/time'
import { useStore } from '@/store/app'
import { blockMinutes } from '@/lib/plan'
import { Dot } from './ui'

/** Per category: logged actual time vs everything planned this week, against budgets. */
export function BudgetBars({ week, wide }: { week: string; wide?: boolean }) {
  const s = useStore((st) => st.state)!
  const log = s.vault.weeks[week]?.log ?? []
  const rows = s.vault.preferences.categories
    .map((c) => {
      const actual = log.filter((l) => l.category === c.key).reduce((a, l) => a + l.actualMin, 0)
      const planned = s.plan.blocks.filter((b) => b.category === c.key && isoWeek(new Date(b.start)) === week).reduce((a, b) => a + blockMinutes(b), 0)
      return { c, actual, planned }
    })
    .filter((r) => r.actual || r.planned || r.c.budget)

  return (
    <div className={wide ? 'grid grid-cols-2 @max-2xl:grid-cols-1 gap-x-8 gap-y-3' : 'max-w-full flex flex-wrap @max-3xl:flex-nowrap @max-3xl:overflow-x-auto @max-3xl:pb-1 gap-x-6 gap-y-2'}>
      {rows.map(({ c, actual, planned }) => {
        const max = Math.max(planned, actual, (c.budget?.maxHours ?? c.budget?.minHours ?? 0) * 60, 60)
        const pct = (m: number) => `${Math.min(100, (m / max) * 100)}%`
        return (
          <div key={c.key} className={wide ? 'min-w-0' : 'w-44 shrink-0'}>
            <div className="flex items-center gap-1.5 text-[11.5px]">
              <Dot color={c.color} />
              <span className="font-medium truncate">{c.label}</span>
              <span className="flex-1" />
              <span className="text-muted whitespace-nowrap" title="actual / planned">
                {fmtDuration(actual)} / {fmtDuration(planned)}
              </span>
            </div>
            <div className="relative h-1.5 mt-1 rounded-full bg-sunken overflow-visible">
              <div className="absolute inset-y-0 left-0 rounded-full opacity-30" style={{ width: pct(planned), background: c.color }} />
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(actual), background: c.color }} />
              {c.budget?.minHours && <div className="absolute -top-0.5 -bottom-0.5 w-px bg-ink/60" style={{ left: pct(c.budget.minHours * 60) }} title={`Target ${c.budget.minHours}h`} />}
              {c.budget?.maxHours && <div className="absolute -top-0.5 -bottom-0.5 w-px bg-danger" style={{ left: pct(c.budget.maxHours * 60) }} title={`Cap ${c.budget.maxHours}h`} />}
            </div>
            {c.budget && (
              <div className="text-[10.5px] text-faint mt-0.5">
                {c.budget.minHours ? `target ${c.budget.minHours}h` : ''}
                {c.budget.minHours && c.budget.maxHours ? ' · ' : ''}
                {c.budget.maxHours ? `cap ${c.budget.maxHours}h` : ''}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
