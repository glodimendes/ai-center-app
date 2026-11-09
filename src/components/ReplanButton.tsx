import { useEffect, useState } from 'react'
import { Dices, Loader2, RotateCcw } from 'lucide-react'
import type { PlanOption, PlanVariant } from '@shared/api'
import { addDays, isoDate, minutesOfDay, parseDate } from '@shared/time'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { categoryOf, cx } from '@/lib/util'
import { Button, Modal } from './ui'

/**
 * The plan stays put during the day: edits only refresh what sits in each block.
 * A full re-plan happens each morning, when preferences change, or from here, under a strategy you pick.
 */
export function ReplanButton() {
  const plan = useStore((s) => s.state!.plan)
  const variant = useStore((s) => s.state!.planVariant)
  const [open, setOpen] = useState(false)
  const at = new Date(plan.fullPlannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-faint" title="Blocks keep their place until the next full re-plan (each morning, after a preference change, or when you click Re-plan). Adding or finishing tasks only changes what's inside them.">
        Planned {at}
        {variant.key !== 'balanced' && ` · ${variant.label}`}
        {variant.seed !== undefined && ' (shuffled)'}
      </span>
      <Button onClick={() => setOpen(true)} title="Compare strategies and rearrange everything that isn't pinned or already started">
        <RotateCcw size={13} /> Re-plan
      </Button>
      {open && <ReplanDialog onClose={() => setOpen(false)} />}
    </div>
  )
}

const VARIANTS: PlanVariant[] = ['balanced', 'deadlines', 'deep', 'light']
const signature = (o: PlanOption) => o.plan.blocks.map((b) => `${b.start}|${b.end}|${b.chunks.map((c) => c.taskId + c.minutes).join(',')}`).join(';')
const newSeed = () => Math.floor(Math.random() * 1_000_000)

function ReplanDialog({ onClose }: { onClose: () => void }) {
  const current = useStore((s) => s.state!.planVariant)
  const [options, setOptions] = useState<Partial<Record<PlanVariant, PlanOption>>>({})
  const [busy, setBusy] = useState<PlanVariant | null>(null)

  useEffect(() => {
    for (const k of VARIANTS) void act(api.planOption(k, k === current.key ? current.seed : undefined)).then((o) => o && setOptions((x) => ({ ...x, [k]: o })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shuffle = async (k: PlanVariant) => {
    setBusy(k)
    const o = await act(api.planOption(k, newSeed()))
    if (o) setOptions((x) => ({ ...x, [k]: o }))
    setBusy(null)
  }
  const apply = async (o: PlanOption) => {
    await act(api.applyPlanOption(o.key, o.seed), `Re-planned: ${o.label}${o.seed !== undefined ? ' (shuffled)' : ''}`)
    onClose()
  }

  return (
    <Modal onClose={onClose} width="max-w-5xl">
      <div className="p-5">
        <div className="text-[15px] font-semibold">Re-plan</div>
        <p className="text-[12px] text-muted mt-0.5">
          Pick how to rearrange everything that isn't pinned or already started. Each option is the same planner under a different strategy; Shuffle gives another arrangement with the same
          strategy. Next 7 days shown. Applying also frees time you kept empty.
        </p>
        <div className="grid grid-cols-2 gap-3 mt-4">
          {VARIANTS.map((k) => {
            const o = options[k]
            const isCurrent = current.key === k
            return (
              <div key={k} className={cx('rounded-lg border p-3 flex flex-col', isCurrent ? 'border-accent' : 'border-line')}>
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold">{o?.label ?? k}</span>
                  {isCurrent && <span className="text-[10.5px] text-accent">current strategy</span>}
                  {o?.seed !== undefined && <span className="text-[10.5px] text-faint">shuffled</span>}
                  {o && k !== 'balanced' && options.balanced && signature(o) === signature(options.balanced) && (
                    <span className="text-[10.5px] text-faint" title="With your current tasks and calendar this strategy places everything the same way">same plan as Balanced right now</span>
                  )}
                </div>
                <div className="text-[11.5px] text-muted mb-2">{o?.desc}</div>
                {o ? (
                  <>
                    <WeekStrip option={o} />
                    <Metrics option={o} />
                  </>
                ) : (
                  <div className="h-40 grid place-items-center text-faint">
                    <Loader2 size={16} className="animate-spin" />
                  </div>
                )}
                <div className="flex gap-2 mt-3">
                  <Button kind="primary" disabled={!o} onClick={() => o && apply(o)}>
                    Apply
                  </Button>
                  <Button disabled={!o || busy === k} onClick={() => shuffle(k)} title="Another arrangement under the same strategy">
                    {busy === k ? <Loader2 size={13} className="animate-spin" /> : <Dices size={13} />} Shuffle
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}

const FROM = 6 * 60
const TO = 24 * 60

/** Mini week: one column per day, blocks coloured by area. */
function WeekStrip({ option }: { option: PlanOption }) {
  const state = useStore((s) => s.state!)
  const days = Array.from({ length: 7 }, (_, i) => isoDate(addDays(new Date(), i)))
  return (
    <div className="flex gap-1 h-28">
      {days.map((d) => (
        <div key={d} className="flex-1 flex flex-col">
          <div className="text-[9.5px] text-faint text-center">{parseDate(d).toLocaleDateString(undefined, { weekday: 'narrow' })}</div>
          <div className="relative flex-1 rounded bg-sunken overflow-hidden">
            {option.plan.blocks
              .filter((b) => b.start.slice(0, 10) === d && b.kind !== 'break')
              .map((b) => {
                const s = Math.max(FROM, minutesOfDay(new Date(b.start)))
                const e = Math.min(TO, minutesOfDay(new Date(b.end)) || TO)
                if (e <= s) return null
                return (
                  <div
                    key={b.id}
                    className="absolute left-0.5 right-0.5 rounded-sm"
                    style={{ top: `${((s - FROM) / (TO - FROM)) * 100}%`, height: `${Math.max(2, ((e - s) / (TO - FROM)) * 100)}%`, background: categoryOf(state, b.category).color, opacity: b.kind === 'container' ? 0.5 : 0.85 }}
                  />
                )
              })}
          </div>
        </div>
      ))}
    </div>
  )
}

const h = (x: number) => `${Math.round(x * 10) / 10}h`

function Metrics({ option }: { option: PlanOption }) {
  const m = option.metrics
  const rows: [string, string, boolean?][] = [
    ['Work planned', h(m.workHours)],
    ['Deep work', h(m.deepHours)],
    ['After 19:00', h(m.eveningHours)],
    ['Free working time', h(m.freeHours)],
    ['Task switches', String(m.switches)],
    ['Deadline warnings', String(m.atRisk), m.atRisk > 0],
    ["Doesn't fit", String(m.unscheduled), m.unscheduled > 0]
  ]
  return (
    <div className="grid grid-cols-2 gap-x-4 mt-2 text-[11.5px]">
      {rows.map(([label, value, warn]) => (
        <div key={label} className="flex justify-between py-0.5 border-b border-line/60">
          <span className="text-muted">{label}</span>
          <span className={cx('font-medium', warn && 'text-warn')}>{value}</span>
        </div>
      ))}
    </div>
  )
}
