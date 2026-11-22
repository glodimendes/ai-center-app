import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Loader2, MessageSquarePlus, Sparkles, Square } from 'lucide-react'
import type { Action, AgentDef, ChatMessage, Run } from '@shared/agents'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { cx } from '@/lib/util'
import { ApprovalCard, PausedCard, ReviewCard } from '@/components/Inline'
import { MessageFooter, PartButton, PartMenu } from '@/components/MessageActions'
import { Markdown } from '@/lib/markdown'

const CENTRAL = '_central'

/** `@tags` in a user message, highlighted. */
function withTags(text: string): ReactNode[] {
  return text.split(/(^|\s)(@[^\s@]+)/g).map((part, i) => (part.startsWith('@') ? <span key={i} className="text-accent font-medium">{part}</span> : part))
}

/** Chat: a central conversation where you coordinate (tag agents with @), and one conversation per agent. */
export function Chat() {
  const s = useStore((st) => st.state)!
  const target = useStore((st) => st.chatTarget)
  const openChat = useStore((st) => st.openChat)
  const toast = useStore((st) => st.toast)
  const a = s.agents
  const agents = a.agents.filter((g) => !g.builtin)
  const isCentral = target === 'central'
  const agent = isCentral ? undefined : agents.find((g) => g.id === target)
  const key = isCentral ? CENTRAL : (agent?.id ?? CENTRAL)
  const messages = a.chats[key] ?? []

  const drafts = useStore((st) => st.drafts)
  const origins = useStore((st) => st.origins)
  const setDraft = useStore((st) => st.setDraft)
  const text = drafts[key] ?? ''
  const setText = (t: string) => setDraft(key, t)
  const [sending, setSending] = useState(false)
  const [pick, setPick] = useState(0)
  const end = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  // What is going on in this conversation right now.
  const mine = (r: { agentId: string; input: { from: string }; chat?: boolean }) => (isCentral ? r.input.from === 'central' : r.agentId === agent?.id && r.chat)
  const active = a.runs.filter((r) => mine(r) && ['queued', 'running'].includes(r.status))
  const paused = a.runs.filter((r) => mine(r) && r.status === 'paused')
  const goal = isCentral ? a.goals.find((g) => g.origin === 'central' && g.status === 'running') : undefined
  const pending = a.approvals.filter((x) => x.status === 'pending' && (isCentral || x.agentId === agent?.id))
  const lastMsg = messages.at(-1)?.t ?? ''
  const failed = a.runs.filter((r) => mine(r) && (r.status === 'error' || r.status === 'cancelled') && (r.endedAt ?? '') > lastMsg).at(-1)
  const busy = active.length > 0 || paused.length > 0 || Boolean(goal)

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages.length, busy, pending.length, active[0]?.progress.length, Boolean(a.review)])
  useEffect(() => {
    box.current?.focus()
  }, [target])
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [text])

  // @-completion: the tag being typed at the end of the text.
  const tag = isCentral ? text.match(/(^|\s)@([^\s@]*)$/) : null
  const options = useMemo(() => {
    if (!tag) return []
    const q = tag[2].toLowerCase()
    return agents.filter((g) => g.id.includes(q) || g.name.toLowerCase().replace(/\s+/g, '').includes(q)).slice(0, 6)
  }, [tag?.[2], agents.length])
  const choose = (g: AgentDef) => {
    setText(text.replace(/@[^\s@]*$/, `@${g.id} `))
    setPick(0)
    box.current?.focus()
  }

  const send = async () => {
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    try {
      if (isCentral) await api.centralSend(t)
      else await api.chatSend(agent!.id, t, origins[agent!.id])
      setText('')
      if (!isCentral && origins[agent!.id]) useStore.setState((st) => ({ origins: { ...st.origins, [agent!.id]: '' } }))
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSending(false)
    }
  }

  const nameOf = (id?: string) => agents.find((g) => g.id === id)?.name ?? id ?? 'Agent'
  const title = isCentral ? 'Central' : (agent?.name ?? 'Chat')
  const subtitle = isCentral ? 'Tag agents with @, or just ask: your coordinator splits the work.' : (agent?.description ?? '')
  const workingLabel = goal
    ? ((d) => (d ? `Asking ${nameOf(d.agent)}…` : 'Coordinating…'))(goal.steps.at(-1)?.delegations.find((x) => x.status === 'queued'))
    : active[0]
      ? ((n) => (n === 1 ? `${nameOf(active[0].agentId)} ${active[0].status === 'queued' ? 'is waiting…' : 'is working…'}` : `${n} agents are working…`))(new Set(active.map((r) => r.agentId)).size)
      : ''

  return (
    <div className="flex-1 min-h-0 flex">
      <aside className="w-60 shrink-0 border-r border-line/70 overflow-y-auto p-3 @max-3xl:w-14 @max-3xl:p-2">
        <ListItem active={isCentral} onClick={() => openChat('central')} icon={<Sparkles size={15} className="text-accent" />} label="Central" />
        <div className="mt-5 mb-1 px-3 text-[12px] text-faint @max-3xl:hidden">Agents</div>
        {agents.map((g) => {
          const running = a.runs.some((r) => r.agentId === g.id && ['queued', 'running', 'paused'].includes(r.status))
          return <ListItem key={g.id} active={target === g.id} onClick={() => openChat(g.id)} icon={<span className="grid place-items-center w-[15px] text-[12px] font-medium text-muted">{g.name[0]?.toUpperCase()}</span>} label={g.name} dot={running} />
        })}
        {!agents.length && <div className="px-3 py-2 text-[12.5px] text-faint @max-3xl:hidden">No agents yet. Create one in Agents.</div>}
      </aside>

      <section className="flex-1 min-w-0 flex flex-col">
        <header className="drag-region h-14 shrink-0 flex items-center gap-3 px-6">
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] font-semibold truncate">{title}</h1>
            {subtitle && <div className="text-[12px] text-muted truncate">{subtitle}</div>}
          </div>
          {messages.length > 0 && (
            <button
              onClick={() => act(api.chatReset(key), 'Conversation cleared')}
              disabled={busy}
              title="Start a new conversation"
              className="no-drag p-2 rounded-lg text-muted hover:text-ink hover:bg-sunken disabled:opacity-40"
            >
              <MessageSquarePlus size={17} />
            </button>
          )}
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[44rem] mx-auto px-6 pt-4 pb-8 space-y-6">
            {!messages.length && !busy && <Welcome central={isCentral} agent={agent} hasAgents={agents.length > 0} />}
            {messages.map((m, i) => (
              <Message
                key={i}
                m={m}
                name={m.agentId ? nameOf(m.agentId) : (agent?.name ?? 'Agent')}
                origin={key}
                run={m.runId ? a.runs.find((r) => r.id === m.runId) : undefined}
                onRetry={() => {
                  const q = messages.slice(0, i).reverse().find((x) => x.role === 'user')?.text
                  if (!q) return Promise.resolve()
                  return isCentral ? api.centralSend(q) : api.chatSend(agent!.id, q)
                }}
                canRetry={!busy}
                proposals={m.runId ? pending.filter((x) => x.runId === m.runId) : []}
                backTo={(() => {
                  const o = (m.runId ? a.runs.find((r) => r.id === m.runId) : undefined)?.input.packet?.origin
                  return o ? { key: o, name: o === '_central' ? 'Central' : nameOf(o) } : undefined
                })()}
              />
            ))}
            {!isCentral &&
              active.map((r) => (
                <PendingTurn key={r.id} run={r} ahead={a.runs.filter((x) => x.agentId === r.agentId && x.status === 'queued' && x.queuedAt < r.queuedAt).length} />
              ))}
            {paused.map((r) => (
              <PausedCard key={r.id} run={r} />
            ))}
            {a.review && <ReviewCard />}
            {pending.filter((x) => !messages.some((m) => m.runId === x.runId)).map((x) => (
              <ApprovalCard key={x.id} action={x} />
            ))}
            {busy && paused.length === 0 && (
              <div className="flex items-center gap-2 text-[13.5px] text-muted">
                <Loader2 size={14} className="animate-spin text-accent" />
                <span className="truncate">{active[0]?.progress.at(-1) && !isCentral ? active[0].progress.at(-1) : workingLabel}</span>
                {(active[0] || goal) && (
                  <button onClick={() => (goal ? act(api.stopGoal(goal.id)) : act(api.cancelRun(active[0].id)))} className="text-faint hover:text-danger" title="Stop">
                    <Square size={12} />
                  </button>
                )}
              </div>
            )}
            {failed && !busy && <div className="text-[13px] text-danger">{failed.error ?? failed.status}</div>}
            <div ref={end} />
          </div>
        </div>

        <div className="px-6 pb-5">
          <div className="max-w-[44rem] mx-auto relative">
            {options.length > 0 && (
              <div className="absolute bottom-full mb-2 left-0 w-72 rounded-xl border border-line bg-panel shadow-lg p-1 z-10">
                {options.map((g, i) => (
                  <button key={g.id} onMouseDown={(e) => (e.preventDefault(), choose(g))} className={cx('w-full text-left px-3 py-2 rounded-lg text-[13.5px] flex items-center gap-2', i === pick % options.length ? 'bg-sunken' : 'hover:bg-sunken/60')}>
                    <span className="font-medium">{g.name}</span>
                    <span className="text-faint text-[12px]">@{g.id}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="rounded-3xl border border-line bg-panel shadow-sm flex items-end gap-2 pl-5 pr-2.5 py-2.5 focus-within:border-accent/60">
              <textarea
                ref={box}
                value={text}
                onChange={(e) => (setText(e.target.value), setPick(0))}
                onKeyDown={(e) => {
                  if (options.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                    e.preventDefault()
                    setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
                  } else if (options.length && (e.key === 'Tab' || e.key === 'Enter')) {
                    e.preventDefault()
                    choose(options[pick % options.length])
                  } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                rows={1}
                placeholder={isCentral ? 'Ask, or tag an agent with @…' : `Message ${agent?.name ?? 'agent'}…`}
                className="flex-1 bg-transparent outline-none resize-none text-[15px] leading-6 py-1 placeholder:text-faint"
              />
              <button
                onClick={send}
                disabled={!text.trim() || sending}
                title="Send"
                className="shrink-0 w-8 h-8 rounded-full bg-accent text-white grid place-items-center disabled:opacity-30 hover:opacity-90"
              >
                <ArrowUp size={16} />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

/** A message that hasn't been answered yet: working on it, or waiting behind other work. */
function PendingTurn({ run, ahead }: { run: Run; ahead: number }) {
  const handed = run.input.packet
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-3xl bg-sunken/60 border border-dashed border-line px-4 py-2.5 text-[15px] leading-6 whitespace-pre-wrap">
        {run.input.text}
        <div className="mt-1 flex items-center gap-2 text-[11.5px] text-faint whitespace-normal">
          {run.status === 'running' ? <Loader2 size={11} className="animate-spin text-accent" /> : null}
          <span>{run.status === 'running' ? 'Working on it' : ahead > 0 ? `Waiting · ${ahead} ahead` : 'Waiting for its turn'}</span>
          {handed && <span>· handed over</span>}
          <button onClick={() => act(api.cancelRun(run.id))} className="hover:text-danger" title="Cancel this message">
            <Square size={11} />
          </button>
        </div>
      </div>
    </div>
  )
}

function ListItem({ active, onClick, icon, label, dot }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; dot?: boolean }) {
  return (
    <button onClick={onClick} title={label} className={cx('w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13.5px] text-left @max-3xl:justify-center @max-3xl:px-0', active ? 'bg-sunken font-medium' : 'text-ink/80 hover:bg-sunken/60')}>
      {icon}
      <span className="flex-1 truncate @max-3xl:hidden">{label}</span>
      {dot && <Loader2 size={12} className="animate-spin text-accent shrink-0" />}
    </button>
  )
}

function Message({ m, name, origin, run, onRetry, canRetry, proposals, backTo }: { m: ChatMessage; name: string; origin: string; run?: Run; onRetry: () => Promise<unknown>; canRetry: boolean; proposals: Action[]; backTo?: { key: string; name: string } }) {
  const openDoc = useStore((st) => st.openDoc)
  const openChat = useStore((st) => st.openChat)
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null)
  if (m.role === 'note')
    return (
      <div className="text-center text-[12.5px] text-faint">
        <button onClick={() => m.link && openChat(m.link)} className="hover:text-accent">
          {m.text} ↗
        </button>
      </div>
    )
  if (m.role === 'user')
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-3xl bg-sunken px-4 py-2.5 text-[15px] leading-6 whitespace-pre-wrap">{withTags(m.text)}</div>
      </div>
    )
  const time = new Date(m.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  // A selection inside the answer offers to hand just that part on.
  const onMouseUp = () => {
    const s = window.getSelection()
    const t = s?.toString().trim()
    if (!s || !t || s.rangeCount === 0) return void setSel(null)
    const r = s.getRangeAt(0).getBoundingClientRect()
    setSel({ text: t, x: r.left + r.width / 2, y: r.top })
  }
  return (
    <div className="group/msg flex gap-3">
      <span className="shrink-0 mt-0.5 w-6 h-6 rounded-full bg-accent/10 text-accent grid place-items-center text-[12px] font-semibold">{name[0]?.toUpperCase()}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-faint mb-1 flex gap-2">
          <span className="font-medium text-muted">{name}</span>
          <span className="opacity-0 group-hover/msg:opacity-100">{time}</span>
        </div>
        <div className="text-[15px] leading-7 pr-9" onMouseUp={onMouseUp}>
          <Markdown text={m.text} onOpenDoc={openDoc} segmentActions={(source) => <PartButton text={source} origin={origin} />} />
        </div>
        {proposals.map((x) => (
          <ApprovalCard key={x.id} action={x} compact />
        ))}
        <MessageFooter text={m.text} origin={origin} run={run} onRetry={canRetry ? onRetry : undefined} backTo={backTo} />
        {sel && <SelectionToolbar sel={sel} origin={origin} onClose={() => setSel(null)} />}
      </div>
    </div>
  )
}

/** Floats above the selected text; its button opens the same menu as the per-section arrow. */
function SelectionToolbar({ sel, origin, onClose }: { sel: { text: string; x: number; y: number }; origin: string; onClose: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div onMouseDown={(e) => e.preventDefault()} className="fixed z-40 -translate-x-1/2 -translate-y-full pb-2" style={{ left: sel.x, top: sel.y }}>
      <span className="relative inline-block">
        <button onClick={() => setOpen((o) => !o)} className="px-2.5 h-7 rounded-lg bg-ink text-bg text-[12px] shadow-lg flex items-center gap-1">
          Hand over selection
        </button>
        {open && <PartMenu text={sel.text} origin={origin} onClose={() => (setOpen(false), onClose())} />}
      </span>
    </div>
  )
}

function Welcome({ central, agent, hasAgents }: { central: boolean; agent?: AgentDef; hasAgents: boolean }) {
  const go = useStore((st) => st.go)
  return (
    <div className="pt-16 text-center">
      <div className="w-11 h-11 mx-auto rounded-2xl bg-accent/10 grid place-items-center">
        <Sparkles size={20} className="text-accent" />
      </div>
      <h2 className="mt-4 text-[20px] font-semibold">{central ? 'What do you want to get done?' : `Chat with ${agent?.name ?? 'an agent'}`}</h2>
      <p className="mt-2 text-[14px] text-muted max-w-md mx-auto">
        {central
          ? hasAgents
            ? 'Tag one of your agents with @ to give it work directly, or write a goal and your coordinator will split it between them.'
            : 'Create an agent first, then tag it here with @ or let a coordinator split goals between several.'
          : (agent?.description ?? 'A direct conversation. It remembers earlier messages until you start a new one.')}
      </p>
      {central && !hasAgents && (
        <button onClick={() => go('agents')} className="mt-4 px-4 h-9 rounded-full bg-accent text-white text-[13.5px]">
          Create an agent
        </button>
      )}
    </div>
  )
}
