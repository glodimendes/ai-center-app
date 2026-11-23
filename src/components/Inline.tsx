import { Check, Undo2, X } from 'lucide-react'
import type { Action, Run } from '@shared/agents'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { describeRoutine } from '@shared/routines'
import { ChangesList } from './ChangesList'
import { Button } from './ui'

const KIND: Record<Action['kind'], string> = {
  remember: 'Remember',
  'update-instructions': 'Change its instructions',
  schedule: 'Schedule',
  'add-task': 'Add a task',
  'complete-task': 'Complete a task',
  'create-event': 'Create a calendar event',
  'email-draft': 'Save an email draft',
  'api-call': 'Call an API',
  'run-agent': 'Hand work to an agent',
  'new-agent': 'Create an agent'
}

/** Something an agent wants to do that needs your OK. Shown in the conversation that produced it and in Activity. */
export function ApprovalCard({ action, compact }: { action: Action; compact?: boolean }) {
  const toast = useStore((st) => st.toast)
  const agent = useStore((st) => st.state)!.agents.agents.find((g) => g.id === action.agentId)
  const isChange = action.kind === 'update-instructions'
  const detail = Object.entries(action.payload).filter(([k, v]) => (typeof v === 'string' || Array.isArray(v)) && !(isChange && k === 'instructions'))
  const target = action.kind === 'run-agent' ? useStore.getState().state?.agents.agents.find((g) => g.id === action.payload.agent)?.name ?? String(action.payload.agent ?? '') : ''
  // A schedule shows when it runs and, on hover, what it will be asked each time.
  const when = action.kind === 'schedule' ? describeRoutine({ time: String(action.payload.time ?? ''), days: String(action.payload.days ?? 'daily') }) : ''
  // Under the message that proposed it: one line with the two choices (a change of instructions needs the whole card, to read before applying).
  if (compact && !isChange)
    return (
      <div className="mt-2 flex items-center gap-2 rounded-xl border border-line bg-panel pl-3 pr-1.5 py-1.5 text-[13px]">
        <span className="text-faint shrink-0">{action.kind === 'run-agent' ? `→ ${target}` : KIND[action.kind]}</span>
        <span className="flex-1 min-w-0 truncate" title={when ? String(action.payload.prompt ?? action.title) : action.title}>
          {action.title}
          {when && <span className="text-faint"> · {when}</span>}
        </span>
        <Button kind="ghost" onClick={() => act(api.rejectAction(action.id))}>
          Dismiss
        </Button>
        <Button kind="primary" onClick={() => act(api.approveAction(action.id).then((r) => r.status === 'failed' && toast(r.error ?? 'Failed', 'error')))}>
          {action.kind === 'run-agent' ? 'Send' : action.kind === 'remember' ? 'Keep' : action.kind === 'schedule' ? 'Schedule' : 'Add'}
        </Button>
      </div>
    )
  return (
    <div className="rounded-2xl border border-line bg-panel px-4 py-3">
      <div className="text-[11.5px] text-faint">
        {KIND[action.kind]} · {agent?.name ?? action.agentId}
      </div>
      <div className="text-[14px] mt-0.5">{action.title}</div>
      {detail.length > 0 && (
        <div className="mt-1.5 text-[12.5px] text-muted space-y-0.5">
          {detail.slice(0, 4).map(([k, v]) => (
            <div key={k} className="truncate">
              <span className="text-faint">{k}: </span>
              {Array.isArray(v) ? v.join(' › ') : String(v)}
            </div>
          ))}
        </div>
      )}
      {isChange && (
        <div className="mt-2 grid grid-cols-2 gap-2 @max-3xl:grid-cols-1 text-[12px]">
          <div>
            <div className="text-faint mb-0.5">Now</div>
            <div className="whitespace-pre-wrap max-h-44 overflow-y-auto rounded-lg bg-sunken p-2 text-muted">{agent?.instructions ?? ''}</div>
          </div>
          <div>
            <div className="text-faint mb-0.5">Proposed</div>
            <div className="whitespace-pre-wrap max-h-44 overflow-y-auto rounded-lg bg-accent-soft p-2">{String(action.payload.instructions ?? '')}</div>
          </div>
        </div>
      )}
      <div className="flex justify-end gap-1 mt-2">
        <Button kind="ghost" onClick={() => act(api.rejectAction(action.id))}>
          <X size={13} /> {isChange ? 'Keep as it is' : 'Reject'}
        </Button>
        <Button kind="primary" onClick={() => act(api.approveAction(action.id).then((r) => r.status === 'failed' && toast(r.error ?? 'Failed', 'error')))}>
          <Check size={13} /> {isChange ? 'Apply' : 'Approve'}
        </Button>
      </div>
    </div>
  )
}

/** A note an agent kept on its own, shown under the message that led to it. Undo takes it back out of its memory. */
export function RememberedNote({ action }: { action: Action }) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded-xl border border-line/70 bg-sunken/50 pl-3 pr-1.5 py-1 text-[12.5px] text-muted">
      <span className="shrink-0 text-faint">Remembered</span>
      <span className="flex-1 min-w-0 truncate" title={String(action.payload.note ?? action.title)}>{String(action.payload.note ?? action.title)}</span>
      <Button kind="ghost" onClick={() => act(api.undoRemember(action.id))}>
        <Undo2 size={12} /> Undo
      </Button>
    </div>
  )
}

/** A run held because the account is above its usage ceiling. */
export function PausedCard({ run }: { run: Run }) {
  return (
    <div className="rounded-2xl border border-warn/40 bg-panel px-4 py-3">
      <div className="text-[14px]">“{run.agentName}” is paused</div>
      <div className="text-[12.5px] text-muted mt-0.5">{run.pauseReason}</div>
      <div className="flex justify-end gap-1 mt-2">
        <Button kind="ghost" onClick={() => act(api.cancelRun(run.id))}>
          Skip
        </Button>
        <Button kind="ghost" onClick={() => act(api.allowRun(run.id, true))} title="Lifts this account's ceiling by 20 points">
          Allow and raise ceiling
        </Button>
        <Button kind="primary" onClick={() => act(api.allowRun(run.id, false))}>
          Allow once
        </Button>
      </div>
    </div>
  )
}

/** Edits an agent made to your files, held until you Keep or Undo. */
export function ReviewCard() {
  const r = useStore((st) => st.state)!.agents.review
  const toast = useStore((st) => st.toast)
  if (!r) return null
  return (
    <div className="rounded-2xl border border-warn/40 bg-panel overflow-hidden">
      <div className="px-4 pt-3">
        <div className="text-[14px]">Review the changes</div>
        <div className="text-[12.5px] text-muted whitespace-pre-wrap mt-0.5">{r.summary || 'Done.'}</div>
      </div>
      <div className="px-4 py-3">
        <ChangesList changes={r.changes} />
      </div>
      <div className="px-4 pb-3 flex justify-end gap-1">
        <Button
          kind="ghost"
          onClick={async () => {
            const skipped = await api.contextUndo()
            toast(skipped.length ? `Undone, except ${skipped.join(', ')} (changed since).` : 'Changes undone.')
          }}
        >
          <Undo2 size={13} /> Undo all
        </Button>
        <Button kind="primary" onClick={() => act(api.contextKeep())}>
          <Check size={13} /> Keep changes
        </Button>
      </div>
    </div>
  )
}
