import { useMemo, useState } from 'react'
import { ArrowUpRight, Copy, CornerUpLeft, Info, ListPlus, RotateCcw } from 'lucide-react'
import type { Run } from '@shared/agents'
import { rankAgents } from '@shared/route'
import { act, useStore } from '@/store/app'
import { cx } from '@/lib/util'
import { Popover } from './ui'
import { QuickAdd } from './QuickAdd'

/** The first line of a piece of Markdown as a task title: list marks, quotes, checkboxes and bold removed. */
export function taskTitleOf(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? ''
  return line.replace(/^[\s>#*•-]+(\[[ xX]\]\s*)?/, '').replace(/^\d+[.)]\s+/, '').replace(/\*\*|`/g, '').trim()
}

const item = 'w-full text-left px-2.5 py-1.5 rounded-md text-[13px] flex items-center gap-2 hover:bg-sunken'

/** What can be done with an answer or a part of it: hand it to an agent (best fit first), add it as a task, copy it. */
export function PartMenu({ text, origin, onClose }: { text: string; origin: string; onClose: () => void }) {
  const state = useStore((s) => s.state)!
  const handOff = useStore((s) => s.handOff)
  const toast = useStore((s) => s.toast)
  const [adding, setAdding] = useState(false)
  const ranked = useMemo(() => {
    const recent: Record<string, number> = {}
    for (const r of state.agents.runs) recent[r.agentId] = Math.max(recent[r.agentId] ?? 0, Date.parse(r.startedAt ?? r.queuedAt) || 0)
    return rankAgents(text, state.agents.agents.filter((a) => a.id !== origin), recent)
  }, [text, origin, state.agents.agents.length])
  return (
    <Popover onClose={onClose} className="w-72">
      <div className="px-2.5 pt-1 pb-1 text-[11.5px] text-faint">Hand over to</div>
      {ranked.map(({ agent, score }, i) => (
        <button key={agent.id} onClick={() => (handOff(agent.id, text, origin), onClose())} className={item}>
          <ArrowUpRight size={13} className="text-faint shrink-0" />
          <span className="flex-1 truncate">{agent.name}</span>
          {i === 0 && score > 0 && <span className="text-[10.5px] px-1.5 rounded-full bg-accent-soft text-accent">Suggested</span>}
        </button>
      ))}
      {!ranked.length && <div className="px-2.5 py-1.5 text-[12.5px] text-muted">No other agents yet.</div>}
      <div className="my-1 border-t border-line/70" />
      {adding ? (
        <div className="px-1 py-1">
          <QuickAdd autoFocus initialText={taskTitleOf(text)} onDone={onClose} />
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className={item}>
          <ListPlus size={13} className="text-faint" /> Add as task…
        </button>
      )}
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(text)
          toast('Copied')
          onClose()
        }}
        className={item}
      >
        <Copy size={13} className="text-faint" /> Copy
      </button>
    </Popover>
  )
}

/** A small button that opens the PartMenu for one part of an answer. */
export function PartButton({ text, origin, className }: { text: string; origin: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-block">
      <button onClick={() => setOpen((o) => !o)} title="Hand over, add as task, copy" className={cx('w-6 h-6 grid place-items-center rounded-md text-faint hover:text-ink hover:bg-sunken', className)}>
        <ArrowUpRight size={14} />
      </button>
      {open && <PartMenu text={text} origin={origin} onClose={() => setOpen(false)} />}
    </span>
  )
}

const dur = (r: Run) => {
  if (!r.startedAt || !r.endedAt) return ''
  const s = Math.round((Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function RunDetails({ run, onClose }: { run: Run; onClose: () => void }) {
  const openDoc = useStore((s) => s.openDoc)
  const u = run.usage
  return (
    <Popover onClose={onClose} className="w-80">
      <div className="px-2.5 py-1.5 text-[12.5px] space-y-1">
        <div className="font-medium">{run.agentName}</div>
        <div className="text-muted">
          {[run.profile, run.status, dur(run), u?.inputTokens || u?.outputTokens ? `${u?.inputTokens ?? 0} in / ${u?.outputTokens ?? 0} out tokens` : '', u?.costUsd ? `$${u.costUsd.toFixed(3)}` : ''].filter(Boolean).join(' · ')}
        </div>
        {run.progress.length > 0 && (
          <div className="pt-1 border-t border-line/70 text-muted space-y-0.5">
            {run.progress.slice(-10).map((p, i) => (
              <div key={i} className="truncate font-mono text-[11.5px]">{p}</div>
            ))}
          </div>
        )}
        {run.outputFile && (
          <button onClick={() => (openDoc(run.outputFile!), onClose())} className="text-accent underline underline-offset-2">
            Open {run.outputFile.split('/').pop()}
          </button>
        )}
      </div>
    </Popover>
  )
}

/** Under an agent message: copy, retry the question, what the run did, hand over. */
export function MessageFooter({ text, origin, run, onRetry, backTo }: { text: string; origin: string; run?: Run; onRetry?: () => void; backTo?: { key: string; name: string } }) {
  const toast = useStore((s) => s.toast)
  const handOff = useStore((s) => s.handOff)
  const [menu, setMenu] = useState<'hand' | 'info' | null>(null)
  const btn = 'h-6 px-1.5 rounded-md flex items-center text-faint hover:text-ink hover:bg-sunken'
  return (
    <div className="mt-1.5 flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100">
      <button
        title="Copy"
        className={btn}
        onClick={() => {
          void navigator.clipboard?.writeText(text)
          toast('Copied')
        }}
      >
        <Copy size={13} />
      </button>
      {onRetry && (
        <button title="Ask again" className={btn} onClick={() => act(Promise.resolve(onRetry()))}>
          <RotateCcw size={13} />
        </button>
      )}
      {run && (
        <span className="relative inline-block">
          <button title="Details of this run" className={btn} onClick={() => setMenu(menu === 'info' ? null : 'info')}>
            <Info size={13} />
          </button>
          {menu === 'info' && <RunDetails run={run} onClose={() => setMenu(null)} />}
        </span>
      )}
      {backTo && (
        <button title={`Quote this answer in your chat with ${backTo.name}`} className={cx(btn, 'gap-1 text-[12px]')} onClick={() => handOff(backTo.key, text, origin)}>
          <CornerUpLeft size={13} /> Send back to {backTo.name}
        </button>
      )}
      <span className="relative inline-block">
        <button title="Hand over, add as task" className={cx(btn, 'gap-1 text-[12px]')} onClick={() => setMenu(menu === 'hand' ? null : 'hand')}>
          <ArrowUpRight size={13} /> Hand over
        </button>
        {menu === 'hand' && <PartMenu text={text} origin={origin} onClose={() => setMenu(null)} />}
      </span>
    </div>
  )
}
