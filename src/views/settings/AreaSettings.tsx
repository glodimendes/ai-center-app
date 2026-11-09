import { useEffect, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import type { CalendarInfo, CategoryPref, Preferences } from '@shared/types'
import { fmtHM } from '@shared/time'
import { parseMinutes } from '@/lib/util'
import { Button } from '@/components/ui'
import { ContainerPicker } from './HeadingMap'

export const SWATCHES = ['#6366f1', '#0ea5e9', '#14b8a6', '#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b']
export const input = 'h-7 px-2 rounded-md border border-line bg-bg text-[12.5px] outline-none focus:border-accent'

/** A length in minutes, typed and shown as hh:mm (also accepts 90, 1h30). */
export function DurationInput({ value, onChange, className, optional }: { value?: number; onChange: (v: number | undefined) => void; className?: string; optional?: boolean }) {
  const show = (v?: number) => (v === undefined ? '' : fmtHM(v))
  const [text, setText] = useState(show(value))
  useEffect(() => setText(show(value)), [value])
  const commit = () => {
    if (!text.trim() && optional) return onChange(undefined)
    const m = parseMinutes(text)
    if (m === null) return setText(show(value))
    onChange(m)
    setText(show(m))
  }
  return (
    <input
      className={`${input} w-20 ${className ?? ''}`}
      value={text}
      placeholder="hh:mm"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

/** Several start–end windows, tried in the order shown. */
function WindowList({ windows, onChange, fallback }: { windows: [string, string][]; onChange: (w: [string, string][]) => void; fallback: [string, string] }) {
  const set = (i: number, w: [string, string]) => onChange(windows.map((x, j) => (j === i ? w : x)))
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {windows.map((w, i) => (
        <span key={i} className="flex items-center gap-1">
          {windows.length > 1 && <span className="text-faint text-[11px] w-3">{i + 1}.</span>}
          <input type="time" className={input} value={w[0]} onChange={(e) => set(i, [e.target.value, w[1]])} />–
          <input type="time" className={input} value={w[1]} onChange={(e) => set(i, [w[0], e.target.value])} />
          <button onClick={() => onChange(windows.filter((_, j) => j !== i))} className="text-faint hover:text-danger" title="Remove window">
            <X size={13} />
          </button>
        </span>
      ))}
      <Button kind="ghost" className="-ml-1" onClick={() => onChange([...windows, fallback])}>
        <Plus size={13} /> Add window
      </Button>
    </div>
  )
}

const ESTIMATES = [15, 30, 45, 60, 90, 120, 180]

export function AreaSettings({ prefs, setPrefs, calendars }: { prefs: Preferences; setPrefs: (p: Preferences) => void; calendars: CalendarInfo[] }) {
  const setCat = (key: string, patch: Partial<CategoryPref>) => setPrefs({ ...prefs, categories: prefs.categories.map((c) => (c.key === key ? { ...c, ...patch } : c)) })
  const trainingKey = prefs.training.category
  const writable = calendars.filter((k) => k.writable && !prefs.protectedCalendars.some((p) => k.name.toLowerCase().startsWith(p.toLowerCase())))

  const addArea = () => {
    let n = 1
    while (prefs.categories.some((c) => c.key === `area-${n}`)) n++
    const used = new Set(prefs.categories.map((c) => c.color))
    const area: CategoryPref = {
      key: `area-${n}`,
      label: 'New area',
      headings: [],
      calendar: prefs.categories[0]?.calendar ?? 'Personal',
      containers: [],
      defaultEstimateMinutes: 60,
      window: ['08:00', '20:00'],
      preferredWindows: [],
      minBlockMinutes: 30,
      weight: 1,
      timing: 'asap',
      color: SWATCHES.find((c) => !used.has(c)) ?? SWATCHES[0]
    }
    // Keep "Other" last.
    const other = prefs.categories.findIndex((c) => c.key === 'other')
    const categories = [...prefs.categories]
    categories.splice(other < 0 ? categories.length : other, 0, area)
    // A grid row, so the hours grid shows what the planner does (no row = unlimited).
    const hours = { ...prefs.allocation.hours, [area.key]: { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1 } }
    setPrefs({ ...prefs, categories, allocation: { ...prefs.allocation, hours } })
  }

  const removeArea = (key: string) => {
    const { [key]: _gone, ...hours } = prefs.allocation.hours
    setPrefs({ ...prefs, categories: prefs.categories.filter((c) => c.key !== key), allocation: { ...prefs.allocation, hours } })
  }

  return (
    <div className="flex flex-col gap-3">
      {prefs.categories.map((c) => {
        const isTraining = c.key === trainingKey
        const removable = !isTraining && c.key !== 'other'
        return (
          <div key={c.key} className="rounded-lg border border-line p-3">
            <div className="flex items-center gap-2">
              <input className={`${input} w-36 font-medium`} value={c.label} onChange={(e) => setCat(c.key, { label: e.target.value })} />
              <div className="flex gap-1">
                {SWATCHES.map((col) => (
                  <button
                    key={col}
                    onClick={() => setCat(c.key, { color: col })}
                    className="w-4 h-4 rounded-full"
                    style={{ background: col, outline: c.color === col ? `2px solid ${col}` : undefined, outlineOffset: 2 }}
                    title={col}
                  />
                ))}
              </div>
              <span className="flex-1" />
              <span className="text-[11.5px] text-muted">Calendar</span>
              {calendars.length ? (
                <select className={input} value={c.calendar} onChange={(e) => setCat(c.key, { calendar: e.target.value })}>
                  {!writable.some((k) => k.name === c.calendar) && <option>{c.calendar}</option>}
                  {writable.map((k) => (
                    <option key={k.id}>{k.name}</option>
                  ))}
                </select>
              ) : (
                <input className={`${input} w-40`} value={c.calendar} onChange={(e) => setCat(c.key, { calendar: e.target.value })} />
              )}
              {removable && (
                <Button kind="danger" onClick={() => removeArea(c.key)} title="Remove this area (its headings fall back to Other; takes effect when you save)">
                  <Trash2 size={13} />
                </Button>
              )}
            </div>
            <div className="grid grid-cols-[150px_1fr_150px_1fr] gap-x-3 gap-y-2 mt-3 items-center text-[12px]">
              <span className="text-muted">Fill these events</span>
              <div className="col-span-3">
                <ContainerPicker cat={c} onChange={(containers) => setCat(c.key, { containers })} />
              </div>
              {(
                <>
                  <span className="text-muted">Default estimate</span>
                  <select className={`${input} w-fit`} value={c.defaultEstimateMinutes} onChange={(e) => setCat(c.key, { defaultEstimateMinutes: Number(e.target.value) })}>
                    {[...new Set([...ESTIMATES, c.defaultEstimateMinutes])].sort((a, b) => a - b).map((m) => (
                      <option key={m} value={m}>
                        {fmtHM(m)}
                      </option>
                    ))}
                  </select>
                  <span className="text-muted">Allowed window</span>
                  <div className="flex gap-1 items-center">
                    <input type="time" className={input} value={c.window?.[0] ?? ''} onChange={(e) => setCat(c.key, { window: e.target.value ? [e.target.value, c.window?.[1] ?? '21:00'] : undefined })} />
                    –
                    <input type="time" className={input} value={c.window?.[1] ?? ''} onChange={(e) => setCat(c.key, { window: e.target.value ? [c.window?.[0] ?? '08:00', e.target.value] : undefined })} />
                  </div>
                  <span className="text-muted self-start mt-1.5">Preferred windows</span>
                  <div className="col-span-3">
                    <WindowList windows={c.preferredWindows ?? []} onChange={(preferredWindows) => setCat(c.key, { preferredWindows })} fallback={c.window ?? ['08:00', '12:00']} />
                  </div>
                  <span className="text-muted">Weekly target (h)</span>
                  <input
                    className={`${input} w-20`}
                    type="number"
                    value={c.budget?.minHours ?? ''}
                    onChange={(e) => setCat(c.key, { budget: { ...c.budget, minHours: e.target.value ? Number(e.target.value) : undefined } })}
                  />
                  <span className="text-muted">Weekly cap (h)</span>
                  <input
                    className={`${input} w-20`}
                    type="number"
                    value={c.budget?.maxHours ?? ''}
                    onChange={(e) => setCat(c.key, { budget: { ...c.budget, maxHours: e.target.value ? Number(e.target.value) : undefined } })}
                  />
                  <span className="text-muted">Shortest new block</span>
                  <DurationInput optional value={c.minBlockMinutes} onChange={(v) => setCat(c.key, { minBlockMinutes: v })} />
                  <span className="text-muted">Keep tasks whole</span>
                  <label className="flex items-center gap-1.5 col-span-3">
                    <input type="checkbox" checked={Boolean(c.wholeTasks)} onChange={(e) => setCat(c.key, { wholeTasks: e.target.checked })} /> each task goes into one block, never split across blocks or days
                  </label>
                  {isTraining ? (
                    <>
                      <span className="text-muted">Gap around training</span>
                      <DurationInput value={prefs.trainingBufferMinutes} onChange={(v) => setPrefs({ ...prefs, trainingBufferMinutes: v ?? 0 })} />
                      <p className="col-span-4 text-faint text-[11px]">
                        Training is planned from your tasks under its headings, like any area (use 🔁 repeat, e.g. “every Monday”). It doesn't count toward the daily work cap.
                      </p>
                    </>
                  ) : (
                    <>
                      <span className="text-muted">Deep work</span>
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" checked={Boolean(c.deepWork)} onChange={(e) => setCat(c.key, { deepWork: e.target.checked })} /> counts toward the daily deep-work cap
                      </label>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )
      })}
      <Button className="w-fit" onClick={addArea}>
        <Plus size={13} /> Add area
      </Button>
    </div>
  )
}
