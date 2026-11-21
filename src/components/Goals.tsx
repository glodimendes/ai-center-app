import { useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Play, Square, Target } from 'lucide-react'
import type { Goal } from '@shared/agents'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { cx } from '@/lib/util'
import { Button, Modal } from './ui'

const TONE: Record<Goal['status'], string> = { running: 'text-accent', done: 'text-ok', stopped: 'text-muted', 'needs-input': 'text-warn', error: 'text-danger' }

/** Goals: a coordinator agent splits a goal between your other agents. Every step stays visible and every action still needs your OK. */
export function Goals() {
  const a = useStore((st) => st.state)!.agents
  const [starting, setStarting] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const goals = [...a.goals].reverse()
  const coordinators = a.agents.filter((g) => !g.builtin && g.permission === 'read')
  const name = (id: string) => a.agents.find((g) => g.id === id)?.name ?? id

  return (
    <section>
      <div className="flex items-center mb-2">
        <h2 className="flex-1 text-[12px] font-semibold text-muted uppercase tracking-wide">Goals</h2>
        <Button onClick={() => setStarting(true)} disabled={!coordinators.length} title={coordinators.length ? 'Give a coordinator agent a goal' : 'Add a read-only agent first (the Coordinator sample works)'}>
          <Target size={13} /> New goal
        </Button>
      </div>
      {!goals.length && <div className="text-[12px] text-faint">A goal lets one agent coordinate the others. Add the Coordinator sample, then start a goal.</div>}
      {goals.map((g) => (
        <div key={g.id} className="border border-line rounded-md mb-1.5 bg-panel">
          <button onClick={() => setOpen(open === g.id ? null : g.id)} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-left">
            {open === g.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {g.status === 'running' && <Loader2 size={12} className="animate-spin text-accent" />}
            <span className="flex-1 truncate">{g.text}</span>
            <span className="text-[11px] text-muted">{name(g.coordinator)}</span>
            <span className={cx('text-[11px]', TONE[g.status])}>{g.status}</span>
            {g.status === 'running' && (
              <span role="button" title="Stop this goal" onClick={(e) => (e.stopPropagation(), act(api.stopGoal(g.id)))} className="text-muted hover:text-danger">
                <Square size={12} />
              </span>
            )}
          </button>
          {open === g.id && (
            <div className="px-3 pb-3 text-[12px] space-y-2">
              {g.reason && (
                <div className={cx('flex items-center gap-2', TONE[g.status])}>
                  <span className="flex-1">{g.reason}</span>
                  {g.status === 'needs-input' && (
                    <Button onClick={() => act(api.resumeGoal(g.id))}>
                      <Play size={12} /> Continue anyway
                    </Button>
                  )}
                </div>
              )}
              {g.steps.map((s) => (
                <div key={s.turn} className="border-l-2 border-line pl-3 space-y-1">
                  <div className="text-muted">Turn {s.turn}</div>
                  {s.delegations.map((d, i) => (
                    <div key={i}>
                      <div>
                        <b>{name(d.agent)}</b> <span className={d.status === 'error' ? 'text-danger' : d.status === 'done' ? 'text-ok' : 'text-muted'}>{d.status}</span>
                      </div>
                      <div className="text-muted">Asked: {d.message}</div>
                      {d.result && <div className="whitespace-pre-wrap max-h-40 overflow-y-auto bg-sunken rounded-md p-2 mt-0.5">{d.result}</div>}
                    </div>
                  ))}
                </div>
              ))}
              {g.finalText && (
                <div>
                  <div className="text-muted mb-0.5">Result</div>
                  <div className="whitespace-pre-wrap leading-relaxed">{g.finalText}</div>
                </div>
              )}
              <div className="text-[11px] text-faint">
                {g.turns} coordinator turn{g.turns === 1 ? '' : 's'} · {g.delegations} delegation{g.delegations === 1 ? '' : 's'} · files in {g.folder}
              </div>
            </div>
          )}
        </div>
      ))}
      {starting && <StartGoal onClose={() => setStarting(false)} />}
    </section>
  )
}

function StartGoal({ onClose }: { onClose: () => void }) {
  const agents = useStore((st) => st.state)!.agents.agents.filter((g) => !g.builtin)
  const coordinators = agents.filter((g) => g.permission === 'read')
  const [coord, setCoord] = useState(coordinators.find((g) => g.id === 'coordinator')?.id ?? coordinators[0]?.id ?? '')
  const [text, setText] = useState('')
  const input = 'h-8 px-2 rounded-md border border-line bg-bg text-[12.5px] outline-none focus:border-accent'
  const go = async () => {
    await act(api.startGoal(coord, text.trim()))
    onClose()
  }
  return (
    <Modal onClose={onClose}>
      <div className="p-5 space-y-3">
        <h2 className="text-[15px] font-semibold">New goal</h2>
        <p className="text-[12px] text-muted">The coordinator splits the goal between your other agents (at most 8 turns and 12 delegations). Each agent keeps its own permission, and anything with an effect waits for your OK.</p>
        <label className="flex flex-col gap-1 text-[12px]">
          Coordinator
          <select className={input} value={coord} onChange={(e) => setCoord(e.target.value)}>
            {coordinators.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Describe the goal…" className="w-full px-3 py-2 rounded-lg border border-line bg-bg text-[13px] outline-none focus:border-accent resize-none" />
        <div className="flex justify-end gap-2">
          <Button kind="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" onClick={go} disabled={!text.trim() || !coord}>
            <Play size={12} /> Start
          </Button>
        </div>
      </div>
    </Modal>
  )
}
