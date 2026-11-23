import { useState } from 'react'
import { CalendarClock, Pause, Play, Trash2 } from 'lucide-react'
import type { AgentDef, Routine } from '@shared/agents'
import { describeRoutine } from '@shared/routines'
import { api } from '@/lib/api'
import { act } from '@/store/app'
import { cx } from '@/lib/util'
import { Popover } from './ui'

/** The agent's scheduled work (proposed in its chat, created on Schedule): what runs when, pause or delete. */
export function RoutinesMenu({ agent, routines }: { agent: AgentDef; routines: Routine[] }) {
  const [open, setOpen] = useState(false)
  if (!routines.length) return null
  const live = routines.filter((r) => !r.paused).length
  return (
    <span className="no-drag relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Scheduled work"
        className={cx('flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[12px] hover:text-ink', live ? 'text-accent' : 'text-muted')}
      >
        <CalendarClock size={13} className="shrink-0" />
        <span>Scheduled</span>
        <span className="text-faint">{routines.length}</span>
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} align="right" className="w-96">
          <div className="px-2.5 pt-1.5 pb-1 text-[11.5px] text-faint">At these times the app sends the prompt to {agent.name} here. Runs while the app is open; a missed one runs once when you open it.</div>
          {routines.map((r) => (
            <div key={r.id} className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg hover:bg-sunken/60">
              <div className={cx('min-w-0 flex-1', r.paused && 'opacity-50')}>
                <div className="text-[13px] truncate">{r.title}</div>
                <div className="text-[11.5px] text-faint">
                  {describeRoutine(r)}
                  {r.paused ? ' · paused' : ''}
                </div>
                <div className="text-[11.5px] text-muted line-clamp-2" title={r.prompt}>{r.prompt}</div>
              </div>
              <button onClick={() => act(api.setRoutinePaused(r.id, !r.paused))} title={r.paused ? 'Resume' : 'Pause'} className="p-1 rounded text-muted hover:text-ink">
                {r.paused ? <Play size={13} /> : <Pause size={13} />}
              </button>
              <button onClick={() => act(api.removeRoutine(r.id), 'Routine deleted')} title="Delete" className="p-1 rounded text-muted hover:text-danger">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </Popover>
      )}
    </span>
  )
}
