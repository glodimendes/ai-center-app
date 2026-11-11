import { useEffect, useState } from 'react'
import { Dices, Loader2, RotateCcw, Sparkles, X } from 'lucide-react'
import type { PlanOption, PlanVariant, Wish } from '@shared/api'
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
      <span className="text-[11px] text-faint whitespace-nowrap @max-6xl:hidden" title="Blocks keep their place until the next full re-plan (each morning, after a preference change, or when you click Re-plan). Adding or finishing tasks only changes what's inside them.">
        Planned {at}
        {variant.key !== 'balanced' && ` · ${variant.label}`}
        {variant.seed !== undefined && ' (shuffled)'}
      </span>
      <Button onClick={() => setOpen(true)} label="Re-plan" title={`Re-plan: compare strategies and rearrange everything that isn't pinned or already started. Planned ${at}${variant.key !== 'balanced' ? ` · ${variant.label}` : ''}`}>
        <RotateCcw size={13} />
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
        <WishBox onApplied={onClose} />
        <div className="grid grid-cols-1 min-[760px]:grid-cols-2 gap-3 mt-4">
          {VARIANTS.map((k) => {
            const o = options[k]
            const isCurrent = current.key === k
            return (
              <div key={k} className={cx('rounded-lg border p-3 flex flex-col', isCurrent ? 'border-accent' : 'border-line')}>
                <div className="flex flex-wrap items-baseline gap-x-2">
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

/** "Plan with a wish": a sentence becomes concrete changes (Claude Haiku), previewed as a plan before anything is saved. */
function WishBox({ onApplied }: { onApplied: () => void }) {
  const s = useStore((st) => st.state!)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ wish: Wish; changes: string[]; option: PlanOption } | null>(null)
  const today = isoDate(new Date())
  const active = Object.entries(s.vault.weeks).flatMap(([week, w]) => [
    ...(w.overrides?.dayRules ?? [])
      .filter((r) => (r.dates ?? []).some((d) => d >= today))
      .map((r) => ({ id: r.id, when: (r.dates ?? []).join(', '), label: r.label, remove: () => api.removeWeekRule(week, r.id) })),
    ...w.pins
      .filter((p) => p.blockId.startsWith('wish:') && p.start.slice(0, 10) >= today)
      .map((p) => ({ id: p.blockId, when: `${p.start.slice(0, 10)} ${p.start.slice(11, 16)}–${p.end.slice(11, 16)}`, label: `Focus: ${p.title}`, remove: () => api.unpin(p.blockId) }))
  ])

  const ask = async () => {
    if (!text.trim()) return
    setBusy(true)
    setPreview(null)
    const r = await act(api.planWish(text.trim()))
    if (r) setPreview(r)
    setBusy(false)
  }
  const apply = async () => {
    await act(api.applyWish(preview!.wish), 'Wish applied and re-planned')
    onApplied()
  }

  return (
    <div className="mt-4 rounded-lg border border-line p-3">
      <div className="flex items-center gap-1.5 text-[13px] font-semibold mb-1.5">
        <Sparkles size={14} className="text-accent" /> Plan with a wish
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void ask()}
          placeholder="e.g. light Friday, thesis-heavy Monday, no work after 18:00 this week"
          className="flex-1 min-w-48 h-8 px-2.5 rounded-md border border-line bg-bg text-[12.5px] outline-none focus:border-accent"
        />
        <Button onClick={() => void ask()} disabled={busy || !text.trim()}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : null} Preview
        </Button>
      </div>
      <p className="text-[11px] text-faint mt-1">Claude Haiku turns it into changes for the next 14 days (it sees only this sentence and your areas and hours). You see the plan before anything is saved.</p>
      {preview && (
        <div className="mt-3 rounded-lg border border-accent p-3 flex flex-col">
          <div className="text-[13px] font-semibold">{preview.wish.summary || 'Your wish'}</div>
          <ul className="text-[11.5px] text-muted my-1.5 list-disc pl-4">
            {preview.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <WeekStrip option={preview.option} />
          <Metrics option={preview.option} />
          <div className="flex gap-2 mt-3">
            <Button kind="primary" onClick={() => void apply()}>
              Apply the wish
            </Button>
            <Button onClick={() => setPreview(null)}>Discard</Button>
          </div>
        </div>
      )}
      {active.length > 0 && (
        <div className="mt-3 text-[11.5px]">
          <div className="text-faint mb-1">Active wishes</div>
          {active.map((a) => (
            <div key={a.id} className="flex items-center gap-2 min-w-0">
              <span className="text-muted shrink-0">{a.when}</span>
              <span className="flex-1 min-w-0 truncate">{a.label}</span>
              <button onClick={() => void act(a.remove(), 'Wish removed')} className="text-faint hover:text-danger" title="Remove">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

