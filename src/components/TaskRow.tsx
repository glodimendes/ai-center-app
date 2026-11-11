import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Calendar, Check, IndentDecrease, IndentIncrease, ListPlus, Clock, Flag, GripVertical, MoveHorizontal, Repeat, Trash2, Zap } from 'lucide-react'
import type { Priority, Task } from '@shared/types'
import { fmtDuration, isoDate } from '@shared/time'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { categoryOf, cx, inlineMd, parseMinutes, relDay } from '@/lib/util'
import { MoonZzz, Popover } from './ui'
import { RepeatPicker } from './RepeatPicker'
import { describeRepeat } from '@shared/repeat'

const PRI_STYLE: Record<Priority, string> = { urgent: 'text-danger bg-danger/10', high: 'text-warn bg-warn-soft', medium: 'text-faint hidden group-hover:flex', low: 'text-faint bg-sunken' }
// The flag cycles upward and wraps: low → medium → high → urgent → low.
const PRI_NEXT: Record<Priority, Priority> = { low: 'medium', medium: 'high', high: 'urgent', urgent: 'low' }

export function TaskRow({
  task,
  depth = 0,
  draggable,
  showSection,
  onAddSubtask,
  skipRepeats,
  onReorder
}: {
  task: Task
  depth?: number
  draggable?: boolean
  showSection?: boolean
  onAddSubtask?: () => void
  skipRepeats?: boolean
  /** Dropping another task on this row, above or below its midline. */
  onReorder?: (draggedId: string, position: 'before' | 'after') => void
}) {
  const state = useStore((s) => s.state)!
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [pop, setPop] = useState<'est' | 'due' | 'repeat' | 'postpone' | null>(null)
  const [est, setEst] = useState('')
  const [dropPos, setDropPos] = useState<'before' | 'after' | null>(null)
  const cat = categoryOf(state, task.category)
  const finish = state.plan.taskFinish[task.id]
  const firstBlock = state.plan.blocks.find((b) => b.chunks.some((c) => c.taskId === task.id) && new Date(b.end) > new Date())
  const atRisk = state.plan.warnings.some((w) => w.taskId === task.id && w.kind === 'deadline')
  const overdue = task.due && task.due < isoDate(new Date())
  // Lists with the section line (Today, Alerts) are narrow: the title gets the room, metadata shrinks.
  const compact = Boolean(showSection)
  const overdueDays = overdue ? Math.round((new Date(isoDate(new Date()) + 'T00:00:00').getTime() - new Date(task.due + 'T00:00:00').getTime()) / 86_400_000) : 0
  const postponed = !task.done && task.postponed && task.postponed > isoDate(new Date()) ? task.postponed : null

  const patch = (p: Parameters<typeof api.patchTask>[1]) => act(api.patchTask(task.id, p))
  // Shown at once and cycled from here, so quick clicks step through levels before the vault write comes back.
  const [pri, setPri] = useState(task.priority)
  useEffect(() => setPri(task.priority), [task.priority])

  // Nesting lives in the Tasks tree (onAddSubtask is only passed there).
  // Nesting needs a task above at the same level (same parent, same section); the first one has none.
  const canNest = state.vault.tasks.some((t) => t.parentId === task.parentId && t.line < task.line && t.section.join('>') === task.section.join('>'))
  const nest = (dir: 'in' | 'out') => act(api.indentTask(task.id, dir), dir === 'in' ? 'Now a subtask of the task above' : 'Moved out one level')

  // Today works on the day in view, so there the trash drops this occurrence of a repeating task
  // and leaves the series; the Tasks view edits the task itself and still deletes the whole line.
  const skipsOccurrence = Boolean(skipRepeats && task.repeat && !task.done)
  const skipOne = async () => {
    const prev = task.due ?? null
    const next = await act(api.skipOccurrence(task.id))
    if (!next) return
    useStore.getState().toast(`Skipped to ${relDay(next)}; the repeat stays`, 'info', {
      label: 'Undo',
      run: () => void act(api.patchTask(task.id, { due: prev }), 'Occurrence back')
    })
  }

  const saveTitle = () => {
    setEditing(false)
    if (title.trim() && title.trim() !== task.title) void patch({ title: title.trim() })
    else setTitle(task.title)
  }

  return (
    <div
      className={cx(
        'group flex items-center gap-2 py-1.5 pr-2 rounded-md hover:bg-sunken/70',
        task.done && 'opacity-55',
        dropPos === 'before' && 'border-t-2 border-accent',
        dropPos === 'after' && 'border-b-2 border-accent'
      )}
      style={{ paddingLeft: 8 + depth * 22 }}
      draggable={draggable && !task.done && !editing}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-task', task.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!onReorder || !e.dataTransfer.types.includes('application/x-task')) return
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        setDropPos(e.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
      }}
      onDragLeave={() => setDropPos(null)}
      onDrop={(e) => {
        if (!onReorder) return
        const draggedId = e.dataTransfer.getData('application/x-task')
        setDropPos(null)
        if (!draggedId || draggedId === task.id) return
        onReorder(draggedId, dropPos ?? 'after')
      }}
    >
      {draggable && <GripVertical size={12} className="text-faint opacity-0 group-hover:opacity-100 -ml-1 shrink-0 cursor-grab" />}
      <button
        onClick={() => (task.done ? patch({ done: false }) : act(api.completeTask(task.id)))}
        className={cx('w-4 h-4 rounded-full border grid place-items-center shrink-0 transition-colors', task.done ? 'bg-accent border-accent text-white' : 'hover:border-accent')}
        style={{ borderColor: task.done ? undefined : cat.color }}
        title={task.done ? 'Reopen' : 'Complete'}
      >
        {task.done && <Check size={10} strokeWidth={3} />}
      </button>

      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTitle()
              if (e.key === 'Tab' && onAddSubtask) {
                e.preventDefault()
                saveTitle()
                if (e.shiftKey ? task.parentId : canNest) void nest(e.shiftKey ? 'out' : 'in')
              }
              if (e.key === 'Escape') {
                setTitle(task.title)
                setEditing(false)
              }
            }}
            className="w-full bg-transparent outline-none border-b border-accent text-[13px]"
          />
        ) : (
          <div
            onDoubleClick={() => setEditing(true)}
            className={cx('text-[13px]', compact ? 'line-clamp-2 break-words leading-snug' : 'truncate', task.done && 'line-through')}
            title={compact ? task.title.replace(/\*\*|`/g, '') : undefined}
            dangerouslySetInnerHTML={{ __html: inlineMd(task.title) }}
          />
        )}
        {showSection && (
          <div className="text-[10.5px] text-faint truncate">
            {!task.done && firstBlock && <span className="text-muted">{relDay(firstBlock.start.slice(0, 10))} {firstBlock.start.slice(11, 16)} · </span>}
            {task.section.join(' › ')}
          </div>
        )}
      </div>

      {!showSection && !task.done && firstBlock && (
        <span className="text-[10.5px] text-muted whitespace-nowrap" title={finish ? `Done by ${finish.replace('T', ' ').slice(0, 16)}` : undefined}>
          {relDay(firstBlock.start.slice(0, 10))} {firstBlock.start.slice(11, 16)}
        </span>
      )}

      <div className="relative">
        <button
          onClick={() => {
            setEst(task.estimateMin ? String(task.estimateMin) : '')
            setPop(pop === 'est' ? null : 'est')
          }}
          className={cx('flex items-center gap-1 px-1.5 h-5 rounded text-[11px]', task.estimateMin && !compact ? 'bg-sunken text-muted' : 'text-faint hidden group-hover:flex')}
          title="Estimate"
        >
          <Clock size={11} />
          {task.estimateMin ? fmtDuration(task.estimateMin) : fmtDuration(cat.defaultEstimateMinutes)}
        </button>
        {pop === 'est' && (
          <Popover onClose={() => setPop(null)} className="right-0 w-48">
            <div className="text-[11px] text-muted mb-1.5">Estimate (remaining)</div>
            <div className="grid grid-cols-4 gap-1 mb-2">
              {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => (
                <button key={m} onClick={() => (patch({ estimateMin: m }), setPop(null))} className={cx('h-6 rounded text-[11px] border border-line hover:bg-sunken', task.estimateMin === m && 'bg-accent-soft border-accent')}>
                  {fmtDuration(m)}
                </button>
              ))}
            </div>
            <input
              autoFocus
              value={est}
              onChange={(e) => setEst(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                const m = parseMinutes(est)
                void patch({ estimateMin: m })
                setPop(null)
              }}
              placeholder="Custom, e.g. 1h20"
              className="w-full px-2 h-7 rounded border border-line bg-bg text-[12px]"
            />
          </Popover>
        )}
      </div>

      <div className="relative">
        {compact && task.due ? (
          <button
            onClick={() => setPop(pop === 'due' ? null : 'due')}
            className={cx('h-5 px-0.5 text-[10.5px] whitespace-nowrap', overdue && !task.done ? 'text-danger font-semibold' : atRisk ? 'text-warn' : 'text-faint')}
            title={overdue ? `Overdue since ${task.due}` : `Due ${task.due}${atRisk ? ' (at risk: the plan finishes after it)' : ''}`}
          >
            {overdue && !task.done ? `${overdueDays}d` : relDay(task.due!)}
          </button>
        ) : (
          <button
            onClick={() => setPop(pop === 'due' ? null : 'due')}
            className={cx(
              'flex items-center gap-1 px-1.5 h-5 rounded text-[11px] whitespace-nowrap',
              task.due ? (overdue && !task.done ? 'bg-danger/10 text-danger' : atRisk ? 'bg-warn-soft text-warn' : 'bg-sunken text-muted') : 'text-faint hidden group-hover:flex'
            )}
            title={atRisk ? 'At risk: the plan finishes after this deadline' : 'Deadline'}
          >
            <Calendar size={11} />
            {task.due ? relDay(task.due) : 'Due'}
          </button>
        )}
        {pop === 'due' && (
          <Popover onClose={() => setPop(null)} className="right-0 w-52">
            <input
              type="date"
              autoFocus
              defaultValue={task.due}
              onChange={(e) => e.target.value && (patch({ due: e.target.value }), setPop(null))}
              className="w-full px-2 h-7 rounded border border-line bg-bg text-[12px]"
            />
            <div className="flex gap-1 mt-2">
              {[0, 1, 7].map((d) => {
                const date = new Date()
                date.setDate(date.getDate() + d)
                const iso = isoDate(date)
                return (
                  <button key={d} onClick={() => (patch({ due: iso }), setPop(null))} className="flex-1 h-6 rounded border border-line text-[11px] hover:bg-sunken">
                    {d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : '+1 week'}
                  </button>
                )
              })}
            </div>
            {task.due && (
              <button onClick={() => (patch({ due: null }), setPop(null))} className="w-full mt-1 h-6 rounded text-[11px] text-danger hover:bg-danger/10">
                Remove deadline
              </button>
            )}
          </Popover>
        )}
      </div>

      <div className="relative">
        <button
          onClick={() => setPop(pop === 'postpone' ? null : 'postpone')}
          className={cx('flex items-center gap-1 px-1.5 h-5 rounded text-[11px] whitespace-nowrap', postponed ? 'bg-indigo-500/10 text-indigo-500' : 'text-faint hidden group-hover:flex')}
          title={postponed ? `Postponed: not planned before ${postponed}` : 'Postpone: not planned before a date'}
        >
          <MoonZzz size={11} />
          {postponed && !compact && relDay(postponed)}
        </button>
        {pop === 'postpone' && (
          <Popover onClose={() => setPop(null)} className="right-0 w-52">
            <div className="text-[11px] text-muted mb-1.5">Postpone until</div>
            <div className="grid grid-cols-2 gap-1 mb-2">
              {postponeChoices().map(([label, days]) => (
                <button key={label} onClick={() => (patch({ postponed: inDays(days) }), setPop(null))} className="h-6 rounded border border-line text-[11px] hover:bg-sunken">
                  {label}
                </button>
              ))}
            </div>
            <input
              type="date"
              min={inDays(1)}
              defaultValue={task.postponed}
              onChange={(e) => e.target.value && (patch({ postponed: e.target.value }), setPop(null))}
              className="w-full px-2 h-7 rounded border border-line bg-bg text-[12px]"
            />
            {task.postponed && (
              <button onClick={() => (patch({ postponed: null }), setPop(null))} className="w-full mt-1 h-6 rounded text-[11px] text-danger hover:bg-danger/10">
                Stop postponing
              </button>
            )}
            <p className="text-[10.5px] text-faint mt-1.5">It isn't planned before that date; from then on it's ranked as usual.</p>
          </Popover>
        )}
      </div>

      <div className="relative">
        <button
          onClick={() => setPop(pop === 'repeat' ? null : 'repeat')}
          className={cx('flex items-center gap-1 px-1.5 h-5 rounded text-[11px] whitespace-nowrap', task.repeat ? 'bg-sunken text-muted' : 'text-faint hidden group-hover:flex')}
          title={task.repeat ? describeRepeat(task.repeat) : 'Repeat'}
        >
          <Repeat size={11} />
          {task.repeat && !compact && <span className="max-w-20 truncate">{describeRepeat(task.repeat).replace(/^Every /, '')}</span>}
        </button>
        {pop === 'repeat' && (
          <Popover onClose={() => setPop(null)} className="right-0 w-60">
            <RepeatPicker value={task.repeat} onPick={(rule) => (patch({ repeat: rule }), setPop(null))} />
          </Popover>
        )}
      </div>

      <button
        onClick={() => (setPri(PRI_NEXT[pri]), patch({ priority: PRI_NEXT[pri] }))}
        className={cx('h-5 px-1 rounded flex items-center gap-0.5 text-[10.5px] capitalize', PRI_STYLE[pri])}
        title={`Priority: ${pri} (click for ${PRI_NEXT[pri]})`}
      >
        {pri === 'low' ? <ArrowDown size={11} /> : pri === 'high' ? <ArrowUp size={11} /> : <Flag size={11} fill={pri === 'urgent' ? 'currentColor' : 'none'} />}
        {pri !== 'medium' && !compact && pri}
      </button>

      <button
        onClick={() => patch({ timing: task.timing === undefined ? 'spread' : task.timing === 'spread' ? 'asap' : null })}
        className={cx('h-5 px-1 rounded flex items-center gap-0.5 text-[10.5px]', task.timing ? 'text-accent bg-accent-soft' : 'text-faint hidden group-hover:flex')}
        title={
          task.timing === 'spread'
            ? 'Spread evenly until the deadline (click: as soon as possible)'
            : task.timing === 'asap'
              ? 'As soon as possible (click: back to the area default)'
              : `Timing: area default (${cat.timing === 'spread' ? 'spread' : 'as soon as possible'}). Click to spread this task.`
        }
      >
        {task.timing === 'asap' ? <Zap size={11} /> : <MoveHorizontal size={11} />}
        {task.timing === 'spread' ? 'spread' : task.timing === 'asap' ? 'asap' : ''}
      </button>

      {onAddSubtask && !task.done && (
        <>
          <button onClick={onAddSubtask} className="h-5 px-1 rounded text-faint hover:text-ink hidden group-hover:block" title="Add subtask">
            <ListPlus size={12} />
          </button>
          {canNest && <button onClick={() => nest('in')} className="h-5 px-1 rounded text-faint hover:text-ink hidden group-hover:block" title="Make it a subtask of the task above (Tab while editing)">
            <IndentIncrease size={12} />
          </button>}
          {task.parentId && (
            <button onClick={() => nest('out')} className="h-5 px-1 rounded text-faint hover:text-ink hidden group-hover:block" title="Move out one level (⇧Tab while editing)">
              <IndentDecrease size={12} />
            </button>
          )}
        </>
      )}

      <button
        onClick={() => (skipsOccurrence ? void skipOne() : act(api.deleteTask(task.id), 'Task deleted (recoverable from git)'))}
        className="h-5 px-1 rounded text-faint hover:text-danger hidden group-hover:block"
        title={skipsOccurrence ? `Skip this one (${describeRepeat(task.repeat!).toLowerCase()} — the series stays)` : 'Delete'}
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}

/** A task and its subtasks, recursively. Pass `reorderable` to let the user drag a task onto a sibling to reorder it. */
export function TaskTree({ task, depth = 0, showDone, draggable, reorderable }: { task: Task; depth?: number; showDone: boolean; draggable?: boolean; reorderable?: boolean }) {
  const tasks = useStore((s) => s.state!.vault.tasks)
  const children = task.childIds.map((id) => tasks.find((t) => t.id === id)).filter((t): t is Task => Boolean(t) && (showDone || !t!.done))
  const [adding, setAdding] = useState(false)
  const onReorder = reorderable
    ? (draggedId: string, position: 'before' | 'after') => void act(api.reorderTask(draggedId, task.id, position))
    : undefined
  return (
    <>
      <TaskRow task={task} depth={depth} draggable={draggable || reorderable} onAddSubtask={() => setAdding(true)} onReorder={onReorder} />
      {children.map((c) => (
        <TaskTree key={c.id} task={c} depth={depth + 1} showDone={showDone} draggable={draggable} reorderable={reorderable} />
      ))}
      {adding && <SubtaskInput parent={task} depth={depth + 1} onDone={() => setAdding(false)} />}
    </>
  )
}

/** Inline "new subtask" line, written as-is (tokens like ~1h work) at the end of the parent's subtasks. */
function SubtaskInput({ parent, depth, onDone }: { parent: Task; depth: number; onDone: () => void }) {
  const [text, setText] = useState('')
  const submit = async () => {
    if (!text.trim()) return onDone()
    await act(api.addSubtask(parent.id, text.trim()))
    setText('')
  }
  return (
    <div className="flex items-center gap-2 py-1 pr-2 rounded-md bg-sunken/70" style={{ paddingLeft: 8 + depth * 22 }}>
      <ListPlus size={13} className="text-faint shrink-0" />
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => !text.trim() && onDone()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') onDone()
        }}
        placeholder={`Subtask of “${parent.title}” (Enter adds another, Esc closes)`}
        className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-faint"
      />
    </div>
  )
}

export const inDays = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return isoDate(d)
}
/** Next Monday counts from today (Monday → the following one). */
const toMonday = () => ((8 - new Date().getDay()) % 7) || 7
export const postponeChoices = (): [string, number][] => [
  ['Tomorrow', 1],
  ['In 2 days', 2],
  ['Next Monday', toMonday()],
  ['In 1 week', 7],
  ['In 2 weeks', 14],
  ['In 1 month', 30]
]
