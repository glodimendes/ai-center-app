import { useState } from 'react'
import { DAY_KEYS, describeRepeat, parseRepeat } from '@shared/repeat'
import { cx } from '@/lib/util'

const COMMON = ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly']
const UNITS = [
  ['d', 'days'],
  ['w', 'weeks'],
  ['m', 'months'],
  ['y', 'years']
] as const
const DAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** Common repeat rules, or a custom "every N units" / set of weekdays. Writes the `repeat:` token. */
export function RepeatPicker({ value, onPick, perWeek, onHabit }: { value?: string; onPick: (rule: string | null) => void; perWeek?: number; onHabit?: (times: number | null) => void }) {
  const [times, setTimes] = useState(perWeek ?? 3)
  const current = value ? parseRepeat(value) : null
  const [n, setN] = useState(current && 'every' in current ? current.every : 2)
  const [unit, setUnit] = useState<'d' | 'w' | 'm' | 'y'>(current && 'every' in current ? current.unit : 'w')
  const [days, setDays] = useState<number[]>(current && 'weekdays' in current ? current.weekdays : [])
  return (
    <div className="text-[11.5px]">
      <div className="text-muted mb-1.5">Repeat</div>
      <div className="grid grid-cols-2 gap-1 mb-2">
        {COMMON.map((r) => (
          <button key={r} onClick={() => onPick(r)} className={cx('h-6 rounded border border-line hover:bg-sunken', value === r && 'bg-accent-soft border-accent')}>
            {describeRepeat(r)}
          </button>
        ))}
      </div>
      <div className="text-muted mb-1">Custom</div>
      <div className="flex items-center gap-1 mb-1.5">
        <span>Every</span>
        <input type="number" min={1} value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))} className="w-12 h-6 px-1 rounded border border-line bg-bg" />
        <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)} className="h-6 rounded border border-line bg-bg">
          {UNITS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <button onClick={() => onPick(`${n}${unit}`)} className="ml-auto px-2 h-6 rounded bg-accent text-white">
          Set
        </button>
      </div>
      <div className="flex items-center gap-1">
        <span>On</span>
        {DAY_SHORT.map((label, d) => (
          <button
            key={d}
            onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}
            className={cx('w-5 h-6 rounded border border-line', days.includes(d) && 'bg-accent text-white border-accent')}
            title={DAY_KEYS[d]}
          >
            {label}
          </button>
        ))}
        <button disabled={!days.length} onClick={() => onPick([...days].sort().map((d) => DAY_KEYS[d]).join(','))} className="ml-auto px-2 h-6 rounded bg-accent text-white disabled:opacity-40">
          Set
        </button>
      </div>
      {value && (
        <button onClick={() => onPick(null)} className="w-full mt-2 h-6 rounded text-danger hover:bg-danger/10">
          Stop repeating
        </button>
      )}
      <p className="text-faint mt-2">When you check it off, the next one is added with the next due date.</p>
      {onHabit && (
        <div className="mt-3 pt-2 border-t border-line">
          <div className="text-muted mb-1">Or a habit, any days</div>
          <div className="flex items-center gap-1">
            <input type="number" min={1} max={7} value={times} onChange={(e) => setTimes(Math.min(7, Math.max(1, Number(e.target.value) || 1)))} className="w-12 h-6 px-1 rounded border border-line bg-bg" />
            <span>× a week</span>
            <button onClick={() => onHabit(times)} className="ml-auto px-2 h-6 rounded bg-accent text-white">
              Set
            </button>
          </div>
          {perWeek && (
            <button onClick={() => onHabit(null)} className="w-full mt-2 h-6 rounded text-danger hover:bg-danger/10">
              Stop the habit
            </button>
          )}
          <p className="text-faint mt-2">The planner spreads that many sessions over the week, one a day; checking it off logs a session and keeps it open.</p>
        </div>
      )}
    </div>
  )
}
