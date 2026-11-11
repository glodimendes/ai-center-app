import { useState } from 'react'
import { Check, Moon } from 'lucide-react'
import type { Block, LogStatus, Task } from '@shared/types'
import { addDays, fmtDuration, fmtHM, isoDate, minutesOfDay } from '@shared/time'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { blockMinutes, blockTitle, logFor, pinFromBlock } from '@/lib/plan'
import { categoryOf, cx, inlineMd } from '@/lib/util'
import { Button, Dot, Modal } from './ui'

const hm = (iso: string) => fmtHM(minutesOfDay(new Date(iso)))

/**
 * End-of-day check (Sunsama's shutdown): log what happened in today's blocks, decide what to do with
 * what's left, and see tomorrow. Nothing is written until a button is clicked.
 */
export function Shutdown({ onClose }: { onClose: () => void }) {
  const s = useStore((st) => st.state)!
  const today = isoDate(new Date())
  const tomorrow = isoDate(addDays(new Date(), 1))
  const todays = s.plan.blocks.filter((b) => b.start.slice(0, 10) === today && b.kind !== 'break' && new Date(b.start) <= new Date())
  const unlogged = todays.filter((b) => !logFor(s, b) && (b.chunks.length || b.kind !== 'topup'))
  const taskIds = new Set(todays.flatMap((b) => b.chunks.map((c) => c.taskId)))
  const leftover = s.vault.tasks.filter((t) => taskIds.has(t.id) && !t.done)
  const next = s.plan.blocks.filter((b) => b.start.slice(0, 10) === tomorrow).sort((a, b) => a.start.localeCompare(b.start))
  const title = (id: string) => s.vault.tasks.find((t) => t.id === id)?.title ?? ''

  return (
    <Modal onClose={onClose} width="max-w-2xl">
      <div className="p-5 flex flex-col gap-5 text-[12.5px]">
        <div className="flex items-center gap-2">
          <Moon size={16} className="text-accent" />
          <div className="text-[15px] font-semibold">Wrap up the day</div>
        </div>

        <section>
          <h3 className="text-[13px] font-semibold mb-1.5">How did today's blocks go?</h3>
          {!unlogged.length ? (
            <p className="text-faint">{todays.length ? 'Every block so far is logged.' : 'No blocks today.'}</p>
          ) : (
            <div className="flex flex-col divide-y divide-line/60">
              {unlogged.map((b) => (
                <LogRow key={b.id} block={b} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h3 className="text-[13px] font-semibold mb-1.5">Still open from today</h3>
          {!leftover.length ? (
            <p className="text-faint">Nothing left over.</p>
          ) : (
            <div className="flex flex-col divide-y divide-line/60">
              {leftover.map((t) => (
                <LeftoverRow key={t.id} task={t} />
              ))}
            </div>
          )}
          <p className="text-faint mt-1.5">Left alone, unfinished work goes back to the planner and is placed again from tomorrow.</p>
        </section>

        <section>
          <h3 className="text-[13px] font-semibold mb-1.5">Tomorrow</h3>
          {!next.length ? (
            <p className="text-faint">Nothing planned yet.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {next.map((b) => (
                <div key={b.id} className="flex items-start gap-2 min-w-0">
                  <span className="w-24 shrink-0 text-muted whitespace-nowrap">
                    {hm(b.start)}–{hm(b.end)}
                  </span>
                  <Dot color={b.kind === 'break' ? 'var(--color-faint)' : categoryOf(s, b.category).color} className="mt-1.5" />
                  <span className="min-w-0">
                    <span className="font-medium">{blockTitle(b)}</span>
                    {b.chunks.length > 0 && <span className="text-muted">: {b.chunks.map((c) => title(c.taskId).replace(/\*\*|`/g, '')).join(' · ')}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="flex justify-end">
          <Button kind="primary" onClick={onClose}>
            Done for today
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function LogRow({ block }: { block: Block }) {
  const s = useStore((st) => st.state)!
  const planned = blockMinutes(block)
  const ended = new Date(block.end) <= new Date()
  const elapsed = Math.round((Date.now() - new Date(block.start).getTime()) / 300_000) * 5
  const [minutes, setMinutes] = useState(ended ? planned : Math.max(5, Math.min(planned, elapsed)))
  const log = (status: LogStatus) => {
    const entry = {
      blockId: block.id,
      date: block.start.slice(0, 10),
      category: block.category,
      title: blockTitle(block),
      start: block.start,
      plannedMin: planned,
      actualMin: status === 'skipped' ? 0 : minutes,
      status,
      taskIds: block.chunks.map((c) => c.taskId)
    }
    return act(api.logBlock(entry, block.kind === 'container' ? undefined : pinFromBlock(block, block.start, block.end)), `Logged ${blockTitle(block)}`)
  }
  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5">
      <span className="w-24 shrink-0 text-muted whitespace-nowrap">
        {hm(block.start)}–{hm(block.end)}
      </span>
      <Dot color={categoryOf(s, block.category).color} />
      <span className="flex-1 min-w-32 truncate font-medium" title={blockTitle(block)}>
        {blockTitle(block)}
      </span>
      <input
        type="number"
        min={0}
        step={5}
        value={minutes}
        onChange={(e) => setMinutes(Math.max(0, Number(e.target.value) || 0))}
        className="w-16 h-7 px-1.5 rounded border border-line bg-bg text-right"
        title="Minutes actually spent"
      />
      <span className="text-faint w-14 whitespace-nowrap">{fmtDuration(minutes)}</span>
      {(['done', 'partial', 'skipped'] as LogStatus[]).map((st) => (
        <Button key={st} kind={st === 'done' ? 'primary' : 'default'} onClick={() => void log(st)} className="capitalize">
          {st}
        </Button>
      ))}
    </div>
  )
}

function LeftoverRow({ task }: { task: Task }) {
  const s = useStore((st) => st.state)!
  const [done, setDone] = useState(false)
  const inDays = (n: number) => isoDate(addDays(new Date(), n))
  const postpone = (n: number) => act(api.patchTask(task.id, { postponed: inDays(n) }), `Not before ${inDays(n)}`)
  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5">
      <Dot color={categoryOf(s, task.category).color} />
      <span className={cx('flex-1 min-w-32 truncate', done && 'line-through text-muted')} dangerouslySetInnerHTML={{ __html: inlineMd(task.title) }} />
      <Button kind="ghost" disabled={done} onClick={() => void act(api.completeTask(task.id)).then(() => setDone(true))} title={task.perWeek ? 'Log a session' : 'It got done after all'}>
        <Check size={13} /> Done
      </Button>
      <Button kind="ghost" disabled={done} onClick={() => void postpone(2)} title="Not planned before the day after tomorrow">
        In 2 days
      </Button>
      <Button kind="ghost" disabled={done} onClick={() => void postpone(7)} title="Not planned before next week">
        Next week
      </Button>
    </div>
  )
}
