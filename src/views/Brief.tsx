import { NO_AREA } from '@shared/categories'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, CalendarClock, CheckSquare, Dumbbell, Flag, Inbox, Loader2, Mail, Notebook, Plus, RefreshCw, Sparkles, Timer } from 'lucide-react'
import type { BriefData, Block, CalEvent, Task } from '@shared/types'
import { addDays, fmtDuration, fmtHM, isoDate, minutesOfDay } from '@shared/time'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { blockMinutes, blockTitle, logFor } from '@/lib/plan'
import { calendarColor, categoryOf, cx, inlineMd, relDay } from '@/lib/util'
import { Button, Dot, Header } from '@/components/ui'

const RIBBON_START = 7
const RIBBON_END = 23

/** Morning overview: the day as a ribbon plus cards. Codex's emailed brief fills the attention cards. */
export function Brief() {
  const s = useStore((st) => st.state)!
  const { go, setDay, selectBlock } = useStore()
  const today = isoDate(new Date())
  const [brief, setBrief] = useState<BriefData | null>(null)
  const [progress, setProgress] = useState<string[]>([])
  const [added, setAdded] = useState<Set<string>>(new Set())

  useEffect(() => {
    void api.getBrief(today).then(setBrief)
  }, [today, s])
  useEffect(() => window.api.onBriefProgress((l) => setProgress((p) => (p.at(-1) === l ? p : [...p.slice(-5), l]))), [])
  useEffect(() => {
    if (s.brief.running) setProgress([])
  }, [s.brief.running])

  const items = useMemo(() => {
    const ignored = new Set(s.vault.preferences.ignoreCalendars)
    const hidden = new Set(s.settings.hiddenCalendars ?? [])
    const blockEvents = new Set(s.plan.blocks.map((b) => b.eventId).filter(Boolean))
    const events = s.events.filter(
      (e) => !e.allDay && !e.plannerBlockId && !blockEvents.has(e.id) && !ignored.has(e.calendarName) && !hidden.has(e.calendarName) && e.start.slice(0, 10) === today
    )
    const blocks = s.plan.blocks.filter((b) => b.start.slice(0, 10) === today)
    return { events, blocks }
  }, [s, today])

  const hiddenCals = new Set(s.settings.hiddenCalendars ?? [])
  const allDay = s.events.filter((e) => e.allDay && !hiddenCals.has(e.calendarName) && e.start.slice(0, 10) <= today && e.end.slice(0, 10) > today)
  const trainingKey = s.vault.preferences.training.category
  const work = items.blocks.filter((b) => b.kind !== 'break' && b.category !== trainingKey && b.category !== NO_AREA)
  const byArea = new Map<string, number>()
  for (const b of work) byArea.set(b.category, (byArea.get(b.category) ?? 0) + blockMinutes(b))
  const plannedMin = [...byArea.values()].reduce((a, b) => a + b, 0)
  const busyMin = items.events.reduce((a, e) => a + (new Date(e.end).getTime() - new Date(e.start).getTime()) / 60000, 0)
  const training = items.blocks.filter((b) => b.category === trainingKey)
  const toLog = s.plan.blocks.filter((b) => b.start.slice(0, 10) === today && b.kind !== 'break' && new Date(b.end) < new Date() && !logFor(s, b))

  const weekEnd = isoDate(addDays(new Date(), 7))
  const open = s.vault.tasks.filter((t) => !t.done && t.due)
  const staleCutoff = isoDate(addDays(new Date(), -s.vault.preferences.staleOverdueDays))
  const staleIds = new Set(open.filter((t) => t.due! < staleCutoff).map((t) => t.id))
  const overdue = open.filter((t) => t.due! < today && !staleIds.has(t.id))
  const dueToday = open.filter((t) => t.due === today)
  const dueWeek = open.filter((t) => t.due! > today && t.due! <= weekEnd).sort((a, b) => a.due!.localeCompare(b.due!))

  const codex = (name: RegExp) => brief?.codex?.sections.find((x) => name.test(x.title))
  const attention = codex(/email|attention/i)
  const priorities = codex(/priorit/i)
  const ai = codex(/ai prep|opportunit/i)
  const inboxSugg = (codex(/temporary inbox/i)?.body ?? '')
    .split('\n')
    .map((l) => l.match(/^\s*[-*]\s+(?:\[ \]\s*)?(.+)$/)?.[1]?.trim())
    .filter((x): x is string => Boolean(x) && !/^none\.?$/i.test(x!))
  const topTasks = s.plan.blocks
    .filter((b) => b.start.slice(0, 10) === today)
    .flatMap((b) => b.chunks.map((c) => c.taskId))
    .filter((id, i, a) => a.indexOf(id) === i)
    .map((id) => s.vault.tasks.find((t) => t.id === id))
    .filter((t): t is Task => Boolean(t) && !t!.done)
    .slice(0, 5)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Header title={greeting} sub={new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}>
        <Button kind="ghost" disabled={s.brief.running} onClick={() => act(api.generateBrief())} label="Run daily brief" title="Run the daily brief now (Claude Haiku, read-only)">
          {s.brief.running ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </Button>
        <Button onClick={() => (setDay(today), go('today'))}>Open Today</Button>
      </Header>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 @max-3xl:px-4 py-5 flex flex-col gap-5">
          {s.brief.running && (
            <div className="rounded-lg bg-accent-soft px-4 py-2.5 text-[12.5px] flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-accent" />
              <span className="font-medium">Preparing today's brief…</span>
              <span className="text-muted truncate">{progress.at(-1) ?? 'Reading your todos, notes, calendar and email (read-only)'}</span>
            </div>
          )}
          {s.brief.error && !s.brief.running && (
            <div className="rounded-lg bg-warn-soft text-warn px-4 py-2.5 text-[12.5px] flex items-center gap-2">
              <AlertTriangle size={14} className="shrink-0" /> <span className="flex-1 min-w-0 break-words">Brief failed: {s.brief.error}</span>
              <Button onClick={() => act(api.generateBrief())}>Try again</Button>
            </div>
          )}
          <div className="grid grid-cols-4 @max-3xl:grid-cols-2 gap-3">
            <Stat icon={<Timer size={14} />} label="Planned work" value={fmtDuration(plannedMin)}>
              <div className="flex h-1.5 rounded-full overflow-hidden mt-2 bg-sunken">
                {[...byArea].map(([k, m]) => (
                  <div key={k} style={{ width: `${(m / Math.max(plannedMin, 1)) * 100}%`, background: categoryOf(s, k).color }} title={`${categoryOf(s, k).label} ${fmtDuration(m)}`} />
                ))}
              </div>
            </Stat>
            <Stat icon={<CalendarClock size={14} />} label="In meetings / classes" value={fmtDuration(busyMin)} sub={items.events[0] ? `First at ${items.events[0].start.slice(11, 16)}` : 'No fixed events'} />
            <Stat icon={<Dumbbell size={14} />} label="Training" value={training.length ? training.map((b) => b.title).join(' + ') : 'Rest'} sub={training.length ? training.map((b) => `${b.start.slice(11, 16)}–${b.end.slice(11, 16)}`).join(', ') : undefined} />
            <Stat icon={<Flag size={14} />} label="Deadlines" value={`${dueToday.length} today`} sub={`${overdue.length} overdue · ${dueWeek.length} this week`} tone={overdue.length ? 'warn' : undefined} />
          </div>

          <Card title="Your day" icon={<CalendarClock size={14} />}>
            <Ribbon events={items.events} blocks={items.blocks} onPick={(id) => (setDay(today), selectBlock(id), go('today'))} />
            {allDay.length > 0 && <div className="mt-2 text-[11.5px] text-muted">All day: {allDay.map((e) => e.title).join(' · ')}</div>}
            {!s.calendar.connected && <div className="mt-2 text-[11.5px] text-faint">Calendar not connected: showing planned blocks only (Settings → Calendar).</div>}
          </Card>

          <div className="grid grid-cols-2 @max-3xl:grid-cols-1 gap-5">
            <Card title="Emails / attention" icon={<Mail size={14} />} source={attention ? 'AI brief' : undefined}>
              {attention ? <Md text={attention.body} /> : <NoBrief running={s.brief.running} />}
            </Card>
            <Card title="Suggested priorities" icon={<Sparkles size={14} />} source={priorities ? 'AI brief' : 'From your plan'}>
              {priorities ? (
                <Md text={priorities.body} />
              ) : (
                <ol className="list-decimal pl-5 text-[12.5px] space-y-1">
                  {topTasks.map((t) => (
                    <li key={t.id}>
                      <span dangerouslySetInnerHTML={{ __html: inlineMd(t.title) }} /> <span className="text-faint text-[11px]">{categoryOf(s, t.category).label}</span>
                    </li>
                  ))}
                  {!topTasks.length && <span className="text-muted">Nothing planned today.</span>}
                </ol>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-3 @max-5xl:grid-cols-2 @max-3xl:grid-cols-1 gap-5">
            <Card title="Due" icon={<Flag size={14} />}>
              <TaskList title="Overdue" tasks={overdue} tone="danger" />
              <TaskList title="Today" tasks={dueToday} />
              <TaskList title="Next 7 days" tasks={dueWeek} />
              {!overdue.length && !dueToday.length && !dueWeek.length && <div className="text-[12px] text-muted">No deadlines this week.</div>}
            </Card>
            <Card title="Active task notes" icon={<Notebook size={14} />}>
              <div className="flex flex-col gap-2.5">
                {brief?.notes.map((n) => (
                  <button key={n.path} onClick={() => useStore.getState().openDoc(n.path)} className="text-left">
                    <div className="text-[12.5px] font-medium">{n.title}</div>
                    {n.status && <div className="text-[11px] text-muted truncate">{n.status}</div>}
                    {n.next.slice(0, 2).map((x, i) => (
                      <div key={i} className="text-[11.5px] text-faint truncate">→ {x.replace(/[*`]/g, '')}</div>
                    ))}
                  </button>
                ))}
              </div>
            </Card>
            <Card title="Needs you" icon={<CheckSquare size={14} />}>
              {toLog.length > 0 && (
                <button onClick={() => (setDay(today), selectBlock(toLog[0].id), go('today'))} className="w-full text-left px-3 py-2 rounded-md bg-accent-soft text-[12px] mb-3">
                  <b className="text-accent">{toLog.length} block{toLog.length > 1 ? 's' : ''} to log</b> <span className="text-muted">from today</span>
                </button>
              )}
              <div className="flex flex-col gap-1">
                {s.plan.warnings
                  .filter((w) => w.kind !== 'unscheduled' && w.kind !== 'stale')
                  .slice(0, 6)
                  .map((w, i) => (
                    <div key={i} className="flex gap-1.5 text-[11.5px] text-warn min-w-0 break-words">
                      <AlertTriangle size={11} className="mt-0.5 shrink-0" /> <span className="min-w-0">{w.message}</span>
                    </div>
                  ))}
                {staleIds.size > 0 && (
                  <button onClick={() => go('review')} className="text-left text-[11.5px] text-muted mt-1">
                    {staleIds.size} stale task{staleIds.size > 1 ? 's' : ''} to reschedule or drop →
                  </button>
                )}
              </div>
            </Card>
          </div>

          {inboxSugg.length > 0 && (
            <Card title="Suggested for TEMPORARY INBOX" icon={<Inbox size={14} />} source="Nothing is added until you click">
              <div className="flex flex-col gap-1.5">
                {inboxSugg.map((t) => (
                  <div key={t} className="flex items-center gap-2 text-[12.5px]">
                    <span className="flex-1" dangerouslySetInnerHTML={{ __html: inlineMd(t) }} />
                    {added.has(t) ? (
                      <span className="text-ok text-[11.5px]">Added</span>
                    ) : (
                      <Button
                        onClick={async () => {
                          await act(api.addTask(['TEMPORARY INBOX'], t.replace(/\*\*/g, '')))
                          setAdded(new Set([...added, t]))
                        }}
                      >
                        <Plus size={12} /> Add
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {ai && (
            <Card title="AI preparation opportunities" icon={<Sparkles size={14} />} source="Suggestions only: nothing runs without you">
              <Md text={ai.body} />
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Ribbon({ events, blocks, onPick }: { events: CalEvent[]; blocks: Block[]; onPick: (id: string) => void }) {
  const s = useStore((st) => st.state)!
  const span = (RIBBON_END - RIBBON_START) * 60
  const pos = (iso: string) => Math.max(0, Math.min(100, ((minutesOfDay(new Date(iso)) - RIBBON_START * 60) / span) * 100))
  const now = new Date()
  const nowPct = pos(now.toISOString())
  const rows: { key: string; id?: string; start: string; end: string; title: string; color: string; look: 'event' | 'block' | 'break' }[] = [
    ...events.map((e) => ({ key: e.id, id: `ev:${e.calendarId}:${e.id}`, start: e.start, end: e.end, title: e.title, color: calendarColor(s, e.calendarName) ?? '#94a3b8', look: 'event' as const })),
    ...blocks.map((b) => ({ key: b.id, id: b.id, start: b.start, end: b.end, title: blockTitle(b), color: b.kind === 'break' ? '#94a3b8' : categoryOf(s, b.category).color, look: b.kind === 'break' ? ('break' as const) : ('block' as const) }))
  ].sort((a, b) => a.start.localeCompare(b.start))

  const hours = Array.from({ length: RIBBON_END - RIBBON_START + 1 }, (_, i) => RIBBON_START + i)
  const hourPct = (h: number) => ((h - RIBBON_START) / (RIBBON_END - RIBBON_START)) * 100

  // Inner padded box (left/right 24px) so 07:00 and 23:00 sit inside the ribbon; items, hour lines,
  // the now-line and the labels all share its coordinates.
  return (
    <div>
      <div className="relative h-16 rounded-lg bg-sunken overflow-hidden">
        <div className="absolute inset-y-0 left-6 right-6">
          {hours.map((h) => (
            <div key={h} className="absolute top-0 bottom-0 w-px bg-line pointer-events-none" style={{ left: `${hourPct(h)}%` }} />
          ))}
          {rows.map((r) => {
            const left = pos(r.start)
            const width = Math.max(0.8, pos(r.end) - left)
            return (
              <button
                key={r.key}
                onClick={() => r.id && onPick(r.id)}
                title={`${r.start.slice(11, 16)}–${r.end.slice(11, 16)} ${r.title}`}
                className={cx('absolute rounded-md px-1.5 text-left overflow-hidden', r.look === 'event' ? 'top-1 h-6 border bg-panel' : 'top-8 h-7', r.look === 'break' && 'border border-dashed opacity-60')}
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  background: r.look === 'event' ? undefined : r.color + (r.look === 'break' ? '1a' : '33'),
                  borderColor: r.color,
                  borderLeft: `3px solid ${r.color}`
                }}
              >
                <span className="text-[10.5px] font-medium whitespace-nowrap">{r.title}</span>
              </button>
            )
          })}
          {nowPct > 0 && nowPct < 100 && <div className="absolute top-0 bottom-0 w-px bg-danger pointer-events-none" style={{ left: `${nowPct}%` }} />}
        </div>
      </div>
      <div className="relative h-4 mt-1 mx-6">
        {hours
          .filter((h) => h % 2 === 0)
          .map((h) => (
            <span key={h} className="absolute text-[10px] text-faint -translate-x-1/2" style={{ left: `${hourPct(h)}%` }}>
              {fmtHM(h * 60)}
            </span>
          ))}
      </div>
      <div className="flex gap-4 mt-1 text-[10.5px] text-faint">
        <span>Top row: calendar events</span>
        <span>Bottom row: planned blocks and breaks</span>
      </div>
    </div>
  )
}

function Card({ title, icon, source, children }: { title: string; icon: ReactNode; source?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-4 min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-accent">{icon}</span>
        <h2 className="text-[13px] font-semibold flex-1 min-w-0 truncate">{title}</h2>
        {source && <span className="text-[10.5px] text-faint truncate max-w-[50%]" title={source}>{source}</span>}
      </div>
      {children}
    </section>
  )
}

function Stat({ icon, label, value, sub, tone, children }: { icon: ReactNode; label: string; value: string; sub?: string; tone?: 'warn'; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3 min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        {icon} {label}
      </div>
      <div className={cx('text-[18px] font-semibold mt-0.5 truncate', tone === 'warn' && 'text-warn')}>{value}</div>
      {sub && <div className="text-[11px] text-faint truncate">{sub}</div>}
      {children}
    </div>
  )
}

function TaskList({ title, tasks, tone }: { title: string; tasks: Task[]; tone?: 'danger' }) {
  const s = useStore((st) => st.state)!
  if (!tasks.length) return null
  return (
    <div className="mb-3">
      <div className={cx('text-[10.5px] uppercase tracking-wide mb-1', tone === 'danger' ? 'text-danger' : 'text-faint')}>{title}</div>
      {tasks.slice(0, 6).map((t) => (
        <div key={t.id} className="flex items-center gap-1.5 text-[12px] py-0.5">
          <Dot color={categoryOf(s, t.category).color} />
          <span className="truncate flex-1" dangerouslySetInnerHTML={{ __html: inlineMd(t.title) }} />
          <span className="text-[10.5px] text-faint whitespace-nowrap">{relDay(t.due!)}</span>
        </div>
      ))}
      {tasks.length > 6 && <div className="text-[11px] text-faint">+{tasks.length - 6} more</div>}
    </div>
  )
}

/** Small Markdown renderer for the Codex brief: headings, bullets, checkboxes, paragraphs. */
function Md({ text }: { text: string }) {
  return (
    <div className="text-[12.5px] leading-relaxed space-y-1">
      {text.split('\n').map((line, i) => {
        const h = line.match(/^#{3,6}\s+(.+)/)
        if (h) return <div key={i} className="font-semibold pt-1" dangerouslySetInnerHTML={{ __html: inlineMd(h[1]) }} />
        const b = line.match(/^(\s*)[-*]\s+(\[( |x|X)\]\s+)?(.+)/)
        if (b)
          return (
            <div key={i} className="flex gap-1.5" style={{ paddingLeft: b[1].length * 8 }}>
              <span className="text-faint">{b[2] ? (b[3] === ' ' ? '☐' : '☑') : '•'}</span>
              <span dangerouslySetInnerHTML={{ __html: inlineMd(b[4]) }} />
            </div>
          )
        const n = line.match(/^\s*(\d+)\.\s+(.+)/)
        if (n)
          return (
            <div key={i} className="flex gap-1.5">
              <span className="text-faint">{n[1]}.</span>
              <span dangerouslySetInnerHTML={{ __html: inlineMd(n[2]) }} />
            </div>
          )
        if (!line.trim()) return null
        return <p key={i} dangerouslySetInnerHTML={{ __html: inlineMd(line) }} />
      })}
    </div>
  )
}

function NoBrief({ running }: { running: boolean }) {
  return (
    <div className="text-[12px] text-muted">
      {running ? (
        <p>Reading your email (read-only)…</p>
      ) : (
        <>
          <p>No brief yet today. It's prepared automatically the first time you open the app each day (Claude Haiku, read-only: it can't send, draft or change anything).</p>
          <Button onClick={() => act(api.generateBrief())} className="mt-2">
            <Sparkles size={12} /> Prepare brief now
          </Button>
        </>
      )}
    </div>
  )
}
