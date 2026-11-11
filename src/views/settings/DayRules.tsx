import { Plus, Trash2 } from 'lucide-react'
import type { DayRule, Preferences, Weekday } from '@shared/types'
import { cx } from '@/lib/util'
import { Button } from '@/components/ui'
import { DurationInput, input } from './AreaSettings'

const DAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

const chip = (on: boolean) => cx('h-6 px-2 rounded-full border text-[11px] capitalize', on ? 'bg-accent text-white border-accent' : 'border-line text-muted hover:text-ink')

/** Rules for some days, so routine changes are a setting, not code: a lighter half-day, no evening work, a cap… */
export function DayRules({ prefs, setPrefs }: { prefs: Preferences; setPrefs: (p: Preferences) => void }) {
  const rules = prefs.dayRules ?? []
  const areas = prefs.categories.filter((c) => c.key !== 'other')
  const set = (id: string, patch: Partial<DayRule>) => setPrefs({ ...prefs, dayRules: rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) })
  const add = () => {
    let n = rules.length + 1
    while (rules.some((r) => r.id === `rule-${n}`)) n++
    setPrefs({ ...prefs, dayRules: [...rules, { id: `rule-${n}`, label: 'New rule', enabled: true, when: 'weekdays', weekdays: ['fri'], areas: [], maxMinutes: 0, from: '18:00' }] })
  }

  return (
    <div className="flex flex-col gap-3 text-[12.5px]">
      {!rules.length && <p className="text-faint">No rules yet.</p>}
      {rules.map((r) => {
        const none = r.maxMinutes <= 0
        return (
          <div key={r.id} className={cx('rounded-lg border border-line p-3 flex flex-col gap-2', !r.enabled && 'opacity-60')}>
            <div className="flex flex-wrap items-center gap-2">
              <input type="checkbox" checked={r.enabled} onChange={(e) => set(r.id, { enabled: e.target.checked })} title="On" />
              <input className={`${input} w-48 font-medium`} value={r.label} onChange={(e) => set(r.id, { label: e.target.value })} />
              <span className="flex-1" />
              <Button kind="danger" onClick={() => setPrefs({ ...prefs, dayRules: rules.filter((x) => x.id !== r.id) })} title="Remove this rule">
                <Trash2 size={13} />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select className={input} value={r.when} onChange={(e) => set(r.id, { when: e.target.value as DayRule['when'] })}>
                <option value="weekdays">Every</option>
                <option value="pick">One day a week, the lightest of</option>
              </select>
              <div className="flex flex-wrap gap-1">
                {DAYS.map((d) => {
                  const on = r.weekdays.includes(d)
                  return (
                    <button key={d} className={chip(on)} onClick={() => set(r.id, { weekdays: on ? r.weekdays.filter((x) => x !== d) : DAYS.filter((x) => x === d || r.weekdays.includes(x)) })}>
                      {d}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select className={input} value={none ? 'none' : 'max'} onChange={(e) => set(r.id, e.target.value === 'none' ? { maxMinutes: 0 } : { maxMinutes: 120, from: undefined, to: undefined })}>
                <option value="none">No</option>
                <option value="max">At most</option>
              </select>
              {!none && <DurationInput value={r.maxMinutes} onChange={(v) => set(r.id, { maxMinutes: v && v > 0 ? v : 60 })} />}
              <span className="text-muted">of</span>
              <div className="flex flex-wrap gap-1">
                <button className={chip(!r.areas.length)} onClick={() => set(r.id, { areas: [] })} title="Every area except training">
                  all work
                </button>
                {areas.map((c) => {
                  const on = r.areas.includes(c.key)
                  return (
                    <button key={c.key} className={chip(on)} onClick={() => set(r.id, { areas: on ? r.areas.filter((x) => x !== c.key) : [...r.areas, c.key] })}>
                      {c.label}
                    </button>
                  )
                })}
              </div>
            </div>
            {none && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted">from</span>
                <input type="time" className={input} value={r.from ?? ''} onChange={(e) => set(r.id, { from: e.target.value || undefined })} />
                <span className="text-muted">to</span>
                <input type="time" className={input} value={r.to ?? ''} onChange={(e) => set(r.id, { to: e.target.value || undefined })} />
                <span className="text-faint">empty = start / end of the day</span>
              </div>
            )}
            <p className="text-[11px] text-faint">{describe(r, prefs)}</p>
          </div>
        )
      })}
      <div>
        <Button onClick={add}>
          <Plus size={13} /> Add a rule
        </Button>
      </div>
    </div>
  )
}

function describe(r: DayRule, prefs: Preferences) {
  const days = r.weekdays.length ? r.weekdays.map((d) => d[0].toUpperCase() + d.slice(1)).join(', ') : 'no day'
  const when = r.when === 'pick' ? `One day a week (of ${days}; the one with the least calendar time, or the one you pick in the weekly review)` : `Every ${days}`
  const what = r.areas.length ? r.areas.map((k) => prefs.categories.find((c) => c.key === k)?.label ?? k).join(', ') : 'work'
  if (r.maxMinutes > 0) return `${when}: at most ${Math.round(r.maxMinutes / 6) / 10}h of ${what}.`
  const span = r.from && r.to ? `between ${r.from} and ${r.to}` : r.from ? `after ${r.from}` : r.to ? `before ${r.to}` : 'all day'
  return `${when}: no ${what} ${span}. Applies to time the planner adds; your calendar events and pinned blocks stay.`
}
