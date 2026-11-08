import { useState } from 'react'
import { Calendar, Check, Clock, Flag, GripVertical, MoveHorizontal, Trash2, Zap } from 'lucide-react'
import type { Priority, Task } from '@shared/types'
import { fmtDuration, isoDate } from '@shared/time'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { categoryOf, cx, inlineMd, parseMinutes, relDay } from '@/lib/util'
import { Popover } from './ui'

const PRI_COLOR: Record<Priority, string> = { high: 'text-danger', medium: 'text-faint', low: 'text-faint/60' }

export function TaskRow({ task, depth = 0, draggable, showSection }: { task: Task; depth?: number; draggable?: boolean; showSection?: boolean }) {
  const state = useStore((s) => s.state)!
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [pop, setPop] = useState<'est' | 'due' | null>(null)
  const [est, setEst] = useState('')
  const cat = categoryOf(state, task.category)
  const finish = state.plan.taskFinish[task.id]
  const firstBlock = state.plan.blocks.find((b) => b.chunks.some((c) => c.taskId === task.id) && new Date(b.end) > new Date())
  const atRisk = state.plan.warnings.some((w) => w.taskId === task.id && w.kind === 'deadline')
  const overdue = task.due && task.due < isoDate(new Date())

  const patch = (p: Parameters<typeof api.patchTask>[1]) => act(api.patchTask(task.id, p))

  const saveTitle = () => {
    setEditing(false)
    if (title.trim() && title.trim() !== task.title) void patch({ title: title.trim() })
    else setTitle(task.title)
  }

  return (
    <div
      className={cx('group flex items-center gap-2 py-1.5 pr-2 rounded-md hover:bg-sunken/70', task.done && 'opacity-55')}
      style={{ paddingLeft: 8 + depth * 22 }}
      draggable={draggable && !task.done && !editing}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-task', task.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      {draggable && <GripVertical size={12} className="text-faint opacity-0 group-hover:opacity-100 -ml-1 shrink-0 cursor-grab" />}
      <button
        onClick={() => patch({ done: !task.done })}
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
              if (e.key === 'Escape') {
                setTitle(task.title)
                setEditing(false)
              }
            }}
            className="w-full bg-transparent outline-none border-b border-accent text-[13px]"
          />
        ) : (
          <div onDoubleClick={() => setEditing(true)} className={cx('truncate text-[13px]', task.done && 'line-through')} dangerouslySetInnerHTML={{ __html: inlineMd(task.title) }} />
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
          className={cx('flex items-center gap-1 px-1.5 h-5 rounded text-[11px]', task.estimateMin ? 'bg-sunken text-muted' : 'text-faint hidden group-hover:flex')}
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

      <button
        onClick={() => patch({ priority: task.priority === 'high' ? 'low' : task.priority === 'low' ? 'medium' : 'high' })}
        className={cx('h-5 px-1 rounded', PRI_COLOR[task.priority], task.priority === 'medium' && 'hidden group-hover:block')}
        title={`Priority: ${task.priority} (click to change)`}
      >
        <Flag size={11} fill={task.priority === 'high' ? 'currentColor' : 'none'} />
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

      <button onClick={() => act(api.deleteTask(task.id), 'Task deleted (recoverable from git)')} className="h-5 px-1 rounded text-faint hover:text-danger hidden group-hover:block" title="Delete">
        <Trash2 size={11} />
      </button>
    </div>
  )
}

/** A task and its subtasks, recursively. */
export function TaskTree({ task, depth = 0, showDone, draggable }: { task: Task; depth?: number; showDone: boolean; draggable?: boolean }) {
  const tasks = useStore((s) => s.state!.vault.tasks)
  const children = task.childIds.map((id) => tasks.find((t) => t.id === id)).filter((t): t is Task => Boolean(t) && (showDone || !t!.done))
  return (
    <>
      <TaskRow task={task} depth={depth} draggable={draggable} />
      {children.map((c) => (
        <TaskTree key={c.id} task={c} depth={depth + 1} showDone={showDone} draggable={draggable} />
      ))}
    </>
  )
}
