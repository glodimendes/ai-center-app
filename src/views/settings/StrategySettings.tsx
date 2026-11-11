import type { CategoryPref, Preferences, Weekday } from '@shared/types'
import { cx } from '@/lib/util'

const DAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const fmt = (h: number) => (Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`)

/** Ordering weights, timing per area and the weekly hours grid. */
export function StrategySettings({ prefs, setPrefs }: { prefs: Preferences; setPrefs: (p: Preferences) => void }) {
  const st = prefs.strategy
  const setSt = (patch: Partial<typeof st>) => setPrefs({ ...prefs, strategy: { ...st, ...patch } })
  const setCat = (key: string, patch: Partial<CategoryPref>) => setPrefs({ ...prefs, categories: prefs.categories.map((c) => (c.key === key ? { ...c, ...patch } : c)) })
  const areas = prefs.categories.filter((c) => c.key !== 'other')
  const grid = prefs.allocation
  const hours = (key: string, d: Weekday) => grid.hours[key]?.[d] ?? 0
  const setHours = (key: string, d: Weekday, v: number) =>
    setPrefs({ ...prefs, allocation: { ...grid, hours: { ...grid.hours, [key]: { ...grid.hours[key], [d]: Math.max(0, v) } } } })
  const dayTotal = (d: Weekday) => areas.reduce((s, c) => s + hours(c.key, d), 0)
  const rowTotal = (key: string) => DAYS.reduce((s, d) => s + hours(key, d), 0)

  return (
    <div className="flex flex-col gap-6 text-[12px]">
      <section>
        <h3 className="font-medium mb-1">What goes first</h3>
        <p className="text-muted mb-3">
          Score = (deadline weight × how close the deadline is + priority weight × priority) × area weight. Tasks due within the guard window always go first.
        </p>
        <div className="grid grid-cols-2 @max-4xl:grid-cols-1 gap-x-8 gap-y-3">
          <Slider label="Deadline weight" value={st.deadlineWeight} min={0} max={5} step={0.5} onChange={(v) => setSt({ deadlineWeight: v })} />
          <Slider label="Priority weight" value={st.priorityWeight} min={0} max={5} step={0.5} onChange={(v) => setSt({ priorityWeight: v })} />
          <Slider label="Deadline guard (days)" value={st.deadlineGuardDays} min={0} max={7} step={1} onChange={(v) => setSt({ deadlineGuardDays: v })} />
          <Slider label="Spread undated tasks over (days)" value={st.spreadDays} min={2} max={10} step={1} onChange={(v) => setSt({ spreadDays: v })} />
        </div>
      </section>

      <section>
        <h3 className="font-medium mb-2">Per area</h3>
        <div className="grid grid-cols-[150px_1fr_170px_150px] @max-4xl:grid-cols-[110px_1fr_auto_auto] gap-x-2 gap-y-2 items-center">
          <span className="text-faint">Area</span>
          <span className="text-faint">Weight</span>
          <span className="text-faint">Timing</span>
          <span className="text-faint truncate" title="Reserve grid hours">Reserve grid hours</span>
          {areas.map((c) => (
            <div key={c.key} className="contents">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} /> {c.label}
              </span>
              <Slider value={c.weight ?? 1} min={0.5} max={3} step={0.1} onChange={(v) => setCat(c.key, { weight: v })} compact />
              <div className="flex rounded-md border border-line overflow-hidden w-fit">
                {(['asap', 'spread'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setCat(c.key, { timing: t })}
                    className={cx('px-2.5 h-6 text-[11px]', (c.timing ?? 'asap') === t ? 'bg-accent text-white' : 'text-muted hover:bg-sunken')}
                    title={t === 'asap' ? 'As soon as possible' : 'Spread evenly until the deadline'}
                  >
                    {t === 'asap' ? 'ASAP' : 'Spread'}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-muted" title="Keep this area's grid hours as blocks even when there are no tasks for them">
                <input type="checkbox" checked={Boolean(c.reserveQuota)} onChange={(e) => setCat(c.key, { reserveQuota: e.target.checked })} /> reserve
              </label>
            </div>
          ))}
        </div>
        <p className="text-faint mt-2">
          Weights only decide which tasks go first. How many hours each area gets comes from the weekly hours grid below (and the daily caps), so to give an area more time, raise its
          hours there. Single tasks can override timing with the ⇄ button in the task list (writes @spread / @asap on the line).
        </p>
      </section>

      <section>
        <div className="flex items-center gap-3 mb-2">
          <h3 className="font-medium">Weekly hours grid</h3>
          <label className="flex items-center gap-1.5 text-muted">
            <input type="checkbox" checked={grid.enabled} onChange={(e) => setPrefs({ ...prefs, allocation: { ...grid, enabled: e.target.checked } })} /> use the grid
          </label>
        </div>
        <p className="text-muted mb-3">Hours set aside for each area per weekday. An area never goes past its hours (except deadlines due within the guard). A 0 sets nothing aside: that area (and Other, which has no row) only gets time left over once areas with hours that day are planned, by task priority.</p>
        <div className="overflow-x-auto pb-1">
          <div className={cx('grid grid-cols-[150px_repeat(7,1fr)_60px] @max-4xl:grid-cols-[110px_repeat(7,1fr)_48px] min-w-[700px] gap-1 items-center', !grid.enabled && 'opacity-40 pointer-events-none')}>
            <span className="sticky left-0 z-10 bg-panel self-stretch" />
            {DAYS.map((d) => (
              <span key={d} className="text-center text-faint capitalize">{d}</span>
            ))}
            <span className="text-right text-faint">week</span>
            {areas.map((c) => (
              <div key={c.key} className="contents">
                <span className="sticky left-0 z-10 bg-panel self-stretch flex items-center gap-1.5 font-medium min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} /> <span className="truncate">{c.label}</span>
                </span>
                {DAYS.map((d) => {
                  const h = hours(c.key, d)
                  return (
                    <div key={d} className="flex items-center justify-center gap-0.5">
                      <button onClick={() => setHours(c.key, d, h - 0.5)} className="w-5 h-6 rounded text-muted hover:bg-sunken">−</button>
                      <span className="w-9 h-6 grid place-items-center rounded text-[11.5px] font-medium" style={{ background: h ? c.color + '26' : undefined, color: h ? undefined : 'var(--color-faint)' }}>
                        {h ? fmt(h) : '–'}
                      </span>
                      <button onClick={() => setHours(c.key, d, h + 0.5)} className="w-5 h-6 rounded text-muted hover:bg-sunken">+</button>
                    </div>
                  )
                })}
                <span className="text-right font-medium">{fmt(rowTotal(c.key))}</span>
              </div>
            ))}
            <span className="sticky left-0 z-10 bg-panel self-stretch flex items-center text-faint">Total</span>
            {DAYS.map((d) => {
              const t = dayTotal(d)
              const cap = (d === 'sat' || d === 'sun' ? prefs.dailyMaxMinutes.weekend : prefs.dailyMaxMinutes.weekday) / 60
              return (
                <span key={d} className={cx('text-center font-medium', t > cap && 'text-warn')} title={t > cap ? `Above the daily cap of ${cap}h` : undefined}>
                  {fmt(t)}
                </span>
              )
            })}
            <span className="text-right font-semibold">{fmt(DAYS.reduce((s, d) => s + dayTotal(d), 0))}</span>
          </div>
        </div>
      </section>
    </div>
  )
}

function Slider({ label, value, min, max, step, onChange, compact }: { label?: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; compact?: boolean }) {
  return (
    <label className={cx('flex items-center gap-3', compact && 'pr-6')}>
      {label && <span className="text-muted w-48 @max-3xl:w-32 shrink-0">{label}</span>}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-[var(--color-accent)]" />
      <span className="w-10 text-right font-medium">{value}</span>
    </label>
  )
}
