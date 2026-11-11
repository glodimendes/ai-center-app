import { useState } from 'react'
import { CalendarDays } from 'lucide-react'
import type { CalendarInfo } from '@shared/types'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { cx } from '@/lib/util'
import { Button, Dot, Popover } from './ui'

/** Header menu: which calendars are shown (display only) and whether their events block planning time. */
export function CalendarFilter() {
  const state = useStore((s) => s.state)!
  const [open, setOpen] = useState(false)
  const { calendars, connected } = state.calendar
  const hidden = new Set(state.settings.hiddenCalendars ?? [])
  const ignored = new Set(state.vault.preferences.ignoreCalendars)

  const groups = new Map<string, CalendarInfo[]>()
  for (const c of calendars) {
    const g = c.source ?? ''
    groups.set(g, [...(groups.get(g) ?? []), c])
  }

  return (
    <div className="relative">
      <Button
        kind="ghost"
        onClick={() => setOpen(!open)}
        disabled={!connected}
        title={connected ? 'Choose which calendars are shown and which block planning time' : 'Connect a calendar in Settings'}
      >
        <CalendarDays size={13} /> <span className="@max-4xl:hidden">Calendars</span>{hidden.size > 0 && <span className="text-faint">({calendars.length - hidden.size}/{calendars.length})</span>}
      </Button>
      {open && (
        <Popover onClose={() => setOpen(false)} align="right" className="w-80">
          <p className="px-1.5 pb-2 text-[11px] text-faint leading-snug">
            Show hides a calendar here only. Busy: its events block time and the planner works around them. Free: shown, but the planner may schedule over them.
          </p>
          {calendars.length === 0 && <div className="px-1.5 py-2 text-[12px] text-muted">No calendars found.</div>}
          {[...groups].map(([source, cals]) => (
            <div key={source} className="mb-1">
              {source && <div className="px-1.5 pt-1.5 pb-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-faint">{source}</div>}
              {cals.map((c) => {
                const visible = !hidden.has(c.name)
                const busy = !ignored.has(c.name)
                return (
                  <div key={c.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-sunken">
                    <input type="checkbox" checked={visible} onChange={(e) => act(api.setCalendarVisible(c.name, e.target.checked))} title="Show" className="shrink-0" />
                    <Dot color={c.color} />
                    <span className={cx('flex-1 min-w-0 truncate text-[12.5px]', !visible && 'text-faint')} title={c.name}>
                      {c.name}
                    </span>
                    <div className="flex shrink-0 rounded border border-line overflow-hidden text-[11px]" title="Busy = plan around its events; Free = may plan over them">
                      {([true, false] as const).map((b) => (
                        <button
                          key={String(b)}
                          onClick={() => b !== busy && act(api.setCalendarBusy(c.name, b))}
                          className={cx('px-1.5 h-5 transition-colors', b === busy ? 'bg-accent text-white' : 'text-muted hover:bg-panel')}
                        >
                          {b ? 'Busy' : 'Free'}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </Popover>
      )}
    </div>
  )
}
