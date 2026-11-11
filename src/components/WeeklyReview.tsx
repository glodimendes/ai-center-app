import { useState } from 'react'
import { Archive, CloudUpload } from 'lucide-react'
import type { Weekday } from '@shared/types'
import { addDays, fmtDuration, isoDate, isoWeek, weekStart } from '@shared/time'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { categoryOf, cx, inlineMd } from '@/lib/util'
import { Button, Dot, Modal } from './ui'
import { ReplanButton } from './ReplanButton'
import { SyncDialog } from './SyncDialog'

const DAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
type Grid = Record<string, Partial<Record<Weekday, number>>>

/** From Friday on, the review plans the coming week; earlier in the week, the current one. */
function defaultWeekStart(now: Date) {
  const start = weekStart(now)
  return now.getDay() === 0 || now.getDay() >= 5 ? addDays(start, 7) : start
}

/**
 * The weekly review as a guided flow: how last week went, tidy the todo list, set the focus and
 * hours for the week ahead, then re-plan and sync. Deterministic; nothing changes without a click.
 */
export function WeeklyReview({ onClose }: { onClose: () => void }) {
  const s = useStore((st) => st.state)!
  const [start, setStart] = useState(() => defaultWeekStart(new Date()))
  const week = isoWeek(start)
  const prevStart = addDays(start, -7)
  const prev = isoWeek(prevStart)
  const data = s.vault.weeks[week]
  const [notes, setNotes] = useState(data?.notes ?? '')
  const [grid, setGrid] = useState<Grid>(() => data?.overrides?.grid ?? s.vault.preferences.allocation.hours)
  const [sync, setSync] = useState(false)
  const prefs = s.vault.preferences
  const areas = prefs.categories.filter((c) => c.key !== prefs.training.category && c.key !== 'other')

  const pickWeek = (d: Date) => {
    setStart(d)
    const w = s.vault.weeks[isoWeek(d)]
    setNotes(w?.notes ?? '')
    setGrid(w?.overrides?.grid ?? prefs.allocation.hours)
  }

  // 1. Last week
  const log = s.vault.weeks[prev]?.log ?? []
  const byArea = new Map<string, { planned: number; actual: number }>()
  for (const l of log) {
    const t = byArea.get(l.category) ?? { planned: 0, actual: 0 }
    t.planned += l.plannedMin
    t.actual += l.actualMin
    byArea.set(l.category, t)
  }
  const prevEnd = isoDate(addDays(prevStart, 6))
  const slipped = s.vault.tasks.filter((t) => !t.done && t.due && t.due <= prevEnd)
  const skipped = log.filter((l) => l.status === 'skipped').length

  // 2. Tidy
  const doneCount = s.vault.tasks.filter((t) => t.done).length

  // 4. Hours and day rules
  const custom = Boolean(data?.overrides?.grid)
  const total = (row?: Partial<Record<Weekday, number>>) => DAYS.reduce((n, d) => n + (row?.[d] ?? 0), 0)
  const setCell = (key: string, d: Weekday, v: number) => setGrid((g) => ({ ...g, [key]: { ...g[key], [d]: Math.max(0, Math.round(v * 2) / 2) } }))
  const pickRules = prefs.dayRules.filter((r) => r.enabled && r.when === 'pick')
  const weekDays = DAYS.map((_, i) => isoDate(addDays(start, i)))

  return (
    <Modal onClose={onClose} width="max-w-3xl">
      <div className="p-5 flex flex-col gap-6 text-[12.5px]">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <div className="text-[15px] font-semibold">Weekly review</div>
          <div className="flex items-center gap-1 text-muted">
            planning
            <select className="h-7 px-1.5 rounded-md border border-line bg-bg" value={isoDate(start)} onChange={(e) => pickWeek(new Date(e.target.value + 'T00:00:00'))}>
              {[-7, 0, 7, 14].map((off) => {
                const d = addDays(weekStart(new Date()), off)
                return (
                  <option key={off} value={isoDate(d)}>
                    {isoWeek(d)} ({d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}){off === 0 ? ' · this week' : off === 7 ? ' · next week' : ''}
                  </option>
                )
              })}
            </select>
          </div>
        </div>

        <Step n={1} title={`How ${prev} went`}>
          {!log.length ? (
            <p className="text-faint">Nothing was logged that week.</p>
          ) : (
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 max-w-md">
              <span className="text-faint">Area</span>
              <span className="text-faint text-right">Planned</span>
              <span className="text-faint text-right">Actual</span>
              {[...byArea].map(([k, t]) => (
                <div key={k} className="contents">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <Dot color={categoryOf(s, k).color} /> <span className="truncate">{categoryOf(s, k).label}</span>
                  </span>
                  <span className="text-right">{fmtDuration(t.planned)}</span>
                  <span className={cx('text-right font-medium', t.actual < t.planned && 'text-warn')}>{fmtDuration(t.actual)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-muted mt-2">
            {log.length} block{log.length === 1 ? '' : 's'} logged{skipped ? `, ${skipped} skipped` : ''}. {slipped.length ? `${slipped.length} task${slipped.length === 1 ? '' : 's'} due by ${prevEnd} still open:` : 'Nothing due that week is still open.'}
          </p>
          {slipped.length > 0 && (
            <ul className="mt-1 max-h-32 overflow-y-auto">
              {slipped.map((t) => (
                <li key={t.id} className="flex gap-2 min-w-0">
                  <span className="text-danger shrink-0">{t.due}</span>
                  <span className="min-w-0 truncate" dangerouslySetInnerHTML={{ __html: inlineMd(t.title) }} />
                </li>
              ))}
            </ul>
          )}
          {slipped.length > 0 && <p className="text-faint mt-1">Move or drop their deadlines in Alerts, or leave them: the planner puts overdue work first.</p>}
        </Step>

        <Step n={2} title="Tidy the todo list">
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!doneCount} onClick={() => act(api.archiveDone()).then((n) => n !== undefined && useStore.getState().toast(`Moved ${n} done task${n === 1 ? '' : 's'} to 05_Tasks/archive/`))}>
              <Archive size={13} /> Archive {doneCount} checked task{doneCount === 1 ? '' : 's'}
            </Button>
            <span className="text-faint">Moves them out of daily-todos.md into this year's archive file, under their heading. Open tasks stay.</span>
          </div>
        </Step>

        <Step n={3} title={`Focus for ${week}`}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== (data?.notes ?? '') && act(api.setWeekNotes(week, notes), 'Focus saved')}
            rows={3}
            placeholder="What matters most this week? (saved in the week's file)"
            className="w-full px-3 py-2 rounded-lg border border-line bg-bg outline-none focus:border-accent resize-y"
          />
        </Step>

        <Step n={4} title={`Hours for ${week}`}>
          <p className="text-muted mb-2">
            {custom ? 'This week has its own hours.' : 'Starts from your usual hours (Settings → Weekly hours grid).'} Changing them here applies to {week} only.
          </p>
          <div className="overflow-x-auto pb-1">
            <div className="grid grid-cols-[110px_repeat(7,minmax(44px,1fr))_44px] gap-1 items-center min-w-[520px]">
              <span />
              {DAYS.map((d) => (
                <span key={d} className="text-center text-faint capitalize">
                  {d}
                </span>
              ))}
              <span className="text-right text-faint">week</span>
              {areas.map((c) => (
                <div key={c.key} className="contents">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <Dot color={c.color} /> <span className="truncate">{c.label}</span>
                  </span>
                  {DAYS.map((d) => (
                    <input
                      key={d}
                      type="number"
                      min={0}
                      step={0.5}
                      value={grid[c.key]?.[d] ?? 0}
                      onChange={(e) => setCell(c.key, d, Number(e.target.value))}
                      className="h-7 w-full min-w-0 text-center rounded border border-line bg-bg outline-none focus:border-accent"
                    />
                  ))}
                  <span className="text-right font-medium">{total(grid[c.key])}h</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            <Button kind="primary" onClick={() => act(api.setWeekGrid(week, grid), `Hours set for ${week}`)}>
              Use these hours for {week}
            </Button>
            {custom && (
              <Button onClick={() => act(api.setWeekGrid(week, null), `${week} uses your usual hours`).then(() => setGrid(prefs.allocation.hours))}>
                Back to usual hours
              </Button>
            )}
          </div>
          {pickRules.map((r) => {
            const auto = s.plan.ruleDays?.find((x) => x.ruleId === r.id && weekDays.includes(x.day))?.day
            const chosen = data?.overrides?.dayPicks?.[r.id]
            return (
              <label key={r.id} className="flex flex-wrap items-center gap-2 mt-3">
                <span className="font-medium">{r.label}</span>
                <select
                  className="h-7 px-1.5 rounded-md border border-line bg-bg"
                  value={chosen ?? ''}
                  onChange={(e) => act(api.setDayPick(week, r.id, e.target.value || null), e.target.value ? `${r.label} on ${e.target.value}` : 'The planner picks the day')}
                >
                  <option value="">Planner picks{!chosen && auto ? ` (${new Date(auto + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' })})` : ''}</option>
                  {weekDays
                    .filter((d) => r.weekdays.includes(DAYS[weekDays.indexOf(d)]))
                    .map((d) => (
                      <option key={d} value={d}>
                        {new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric' })}
                      </option>
                    ))}
                </select>
              </label>
            )
          })}
        </Step>

        <Step n={5} title="Re-plan and sync">
          <div className="flex flex-wrap items-center gap-2">
            <ReplanButton />
            <Button kind="primary" disabled={!s.calendar.connected} onClick={() => setSync(true)} title={s.calendar.connected ? 'Review and push planned blocks' : 'Connect your calendar in Settings'}>
              <CloudUpload size={13} /> Sync to calendar
            </Button>
          </div>
          <p className="text-faint mt-2">Re-plan compares strategies; Sync shows every change before anything is written.</p>
        </Step>

        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
      {sync && <SyncDialog onClose={() => setSync(false)} />}
    </Modal>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex gap-3">
      <div className="w-6 h-6 shrink-0 rounded-full bg-accent-soft text-accent grid place-items-center text-[12px] font-semibold">{n}</div>
      <div className="flex-1 min-w-0">
        <h3 className="text-[13px] font-semibold mb-1.5">{title}</h3>
        {children}
      </div>
    </section>
  )
}
