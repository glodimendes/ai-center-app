import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, FileText, Loader2, MessageSquarePlus, Paperclip, Sparkles, Square } from 'lucide-react'
import type { Action, AgentDef, ChatMessage, FileHit, Run } from '@shared/agents'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { cx } from '@/lib/util'
import { groupSections } from '@/lib/agentGroups'
import { ApprovalCard, PausedCard, ReviewCard } from '@/components/Inline'
import { MessageFooter, PartButton, PartMenu } from '@/components/MessageActions'
import { Markdown } from '@/lib/markdown'
import { FileChips } from '@/components/FileChips'
import { ModelPicker } from '@/components/ModelPicker'
import { FolderMenu } from '@/components/FolderMenu'

const CENTRAL = '_central'

/** `/agent` references in a user message, highlighted (only names of real agents). */
function withTags(text: string, ids: Set<string>): ReactNode[] {
  return text.split(/(^|\s)(\/[^\s/]+)/g).map((part, i) => (part.startsWith('/') && ids.has(part.slice(1).toLowerCase()) ? <span key={i} className="rounded-full bg-accent px-2 pt-px pb-[3px] text-white">{part}</span> : part))
}

/** Chat: a central conversation where you coordinate (refer to agents with /), and one conversation per agent. */
export function Chat() {
  const s = useStore((st) => st.state)!
  const target = useStore((st) => st.chatTarget)
  const openChat = useStore((st) => st.openChat)
  const toast = useStore((st) => st.toast)
  const a = s.agents
  const agents = a.agents.filter((g) => !g.builtin)
  const busyIds = new Set(a.runs.filter((r) => ['queued', 'running', 'paused'].includes(r.status)).map((r) => r.agentId))
  const listed = agents.filter((g) => a.organization.pinned.includes(g.id) || g.id === target || busyIds.has(g.id))
  const isCentral = target === 'central'
  const agent = isCentral ? undefined : agents.find((g) => g.id === target)
  const key = isCentral ? CENTRAL : (agent?.id ?? CENTRAL)
  const messages = a.chats[key] ?? []
  const folder = a.chatFolders[key]

  const drafts = useStore((st) => st.drafts)
  const origins = useStore((st) => st.origins)
  const setDraft = useStore((st) => st.setDraft)
  const text = drafts[key] ?? ''
  const setText = (t: string) => setDraft(key, t)
  const files = useStore((st) => st.draftFiles[key]) ?? []
  const setDraftFiles = useStore((st) => st.setDraftFiles)
  const addFiles = (paths: string[]) => setDraftFiles(key, [...new Set([...files, ...paths.filter(Boolean)])])
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
  // `/` refers to an agent (in Central it sends the message to it), `@` to a file.
  const query = text.match(/(^|\s)@([^\s@]*)$/)?.[2]
  const slashQuery = text.match(/(^|\s)\/([^\s/]*)$/)?.[2]
  const [fileOpts, setFileOpts] = useState<FileHit[]>([])
  useEffect(() => {
    if (query === undefined || slashQuery !== undefined || (isCentral && !query)) return void setFileOpts([])
    let live = true
    const t = setTimeout(() => api.chatFiles(key, query).then((h) => live && setFileOpts(h.slice(0, 8)), () => live && setFileOpts([])), 120)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query, key])
  type Option = { kind: 'agent'; g: AgentDef } | { kind: 'file'; f: FileHit }
  const options = useMemo<Option[]>(() => {
    if (slashQuery !== undefined) {
      const q = slashQuery.toLowerCase()
      return agents.filter((g) => g.id !== agent?.id && (g.id.includes(q) || g.name.toLowerCase().replace(/\s+/g, '').includes(q))).slice(0, 6).map((g): Option => ({ kind: 'agent', g }))
    }
    return query === undefined ? [] : fileOpts.map((f): Option => ({ kind: 'file', f }))
  }, [query, slashQuery, agents.length, fileOpts, agent?.id])
  const choose = (o: Option) => {
    if (o.kind === 'agent') setText(text.replace(/\/[^\s/]*$/, `/${o.g.id} `))
    else (setText(text.replace(/(^|\s)@[^\s@]*$/, '$1')), addFiles([o.f.path]))
    setPick(0)
    box.current?.focus()
  }
  // Pasted images have no file: keep them in app data, then attach them like any other.
  const onPaste = (e: React.ClipboardEvent) => {
    const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (!imgs.length) return
    e.preventDefault()
    for (const f of imgs) {
      const r = new FileReader()
      r.onload = () => api.saveAttachment(key, f.name || 'image.png', String(r.result).split(',')[1] ?? '').then((p) => addFiles([p]), (err) => toast((err as Error).message, 'error'))
      r.readAsDataURL(f)
    }
  }

  const send = async () => {
    const t = text.trim()
    if ((!t && !files.length) || sending) return
    setSending(true)
    try {
      if (isCentral) await api.centralSend(t, files)
      else await api.chatSend(agent!.id, t, origins[agent!.id], files)
      setText('')
      setDraftFiles(key, [])
      if (!isCentral && origins[agent!.id]) useStore.setState((st) => ({ origins: { ...st.origins, [agent!.id]: '' } }))
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSending(false)
    }
  }

  const nameOf = (id?: string) => agents.find((g) => g.id === id)?.name ?? id ?? 'Agent'
  const title = isCentral ? 'Central' : (agent?.name ?? 'Chat')
  const subtitle = isCentral ? 'Use / to send work to an agent, @ for a file, or just ask: your coordinator splits the work.' : (agent?.description ?? '')
  const workingLabel = goal
    ? ((d) => (d ? `Asking ${nameOf(d.agent)}…` : 'Coordinating…'))(goal.steps.at(-1)?.delegations.find((x) => x.status === 'queued'))
    : active[0]
      ? ((n) => (n === 1 ? `${nameOf(active[0].agentId)} ${active[0].status === 'queued' ? 'is waiting…' : 'is working…'}` : `${n} agents are working…`))(new Set(active.map((r) => r.agentId)).size)
      : ''

  return (
    <div className="flex-1 min-h-0 flex">
      <aside className="w-60 shrink-0 border-r border-line/70 overflow-y-auto p-3 @max-3xl:w-14 @max-3xl:p-2">
        <ListItem active={isCentral} onClick={() => openChat('central')} icon={<Sparkles size={15} className="text-accent" />} label="Central" />
        {/* Only pinned agents are listed (Agents → pin), in their groups; an unpinned one shows while its chat is open or busy. */}
        {groupSections(listed, a.organization).map((sec, i) => (
          <div key={sec.name || '_none'}>
            <div className={cx('mb-1 px-3 text-[12px] text-faint @max-3xl:hidden', i === 0 ? 'mt-5' : 'mt-3')}>{sec.name || (a.organization.groups.length ? 'Other agents' : 'Agents')}</div>
            {sec.list.map((g) => {
              const running = a.runs.some((r) => r.agentId === g.id && ['queued', 'running', 'paused'].includes(r.status))
              return <ListItem key={g.id} active={target === g.id} onClick={() => openChat(g.id)} icon={<span className="grid place-items-center w-[15px] text-[12px] font-medium text-muted">{g.name[0]?.toUpperCase()}</span>} label={g.name} dot={running} />
            })}
          </div>
        ))}
        {!agents.length && <div className="mt-5 px-3 py-2 text-[12.5px] text-faint @max-3xl:hidden">No agents yet. Create one in Agents.</div>}
        {agents.length > 0 && !listed.length && <div className="mt-5 px-3 py-2 text-[12.5px] text-faint @max-3xl:hidden">No agents pinned. Pin the ones you talk to in Agents.</div>}
      </aside>

      <section className="flex-1 min-w-0 flex flex-col">
        <header className="drag-region h-14 shrink-0 flex items-center gap-3 px-6">
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] font-semibold truncate">{title}</h1>
            {subtitle && <div className="text-[12px] text-muted truncate">{subtitle}</div>}
          </div>
          {agent && <FolderMenu agent={agent} convo={key} folder={folder} extra={a.chatExtraFolders[key] ?? []} vault={s.vault.vaultPath} />}
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
          <div className="max-w-[44rem] mx-auto px-6 pt-4 pb-8 space-y-6 select-text">
            {!messages.length && !busy && <Welcome central={isCentral} agent={agent} hasAgents={agents.length > 0} />}
            {messages.map((m, i) => (
              <Message
                key={i}
                m={m}
                agentIds={new Set(agents.map((g) => g.id))}
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
              <div className="absolute bottom-full mb-2 left-0 w-96 max-w-full rounded-xl border border-line bg-panel shadow-lg p-1 z-10">
                {options.map((o, i) => (
                  <button key={o.kind === 'agent' ? o.g.id : o.f.path} onMouseDown={(e) => (e.preventDefault(), choose(o))} className={cx('w-full text-left px-3 py-2 rounded-lg text-[13.5px] flex items-center gap-2', i === pick % options.length ? 'bg-sunken' : 'hover:bg-sunken/60')}>
                    {o.kind === 'agent' ? (
                      <>
                        <span className="font-medium">{o.g.name}</span>
                        <span className="text-faint text-[12px]">/{o.g.id}</span>
                      </>
                    ) : (
                      <>
                        <FileText size={13} className="shrink-0 text-faint" />
                        <span className="truncate">{o.f.rel}</span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            )}
            <div
              onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
              onDrop={(e) => {
                const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f))
                if (!paths.length) return
                e.preventDefault()
                addFiles(paths)
              }}
              className="rounded-3xl border border-line bg-panel shadow-sm px-2.5 py-2.5 pl-3 focus-within:border-accent/60"
            >
              <FileChips files={files} onRemove={(f) => setDraftFiles(key, files.filter((x) => x !== f))} className="px-2 pb-2" />
              <div className="flex items-end gap-1.5">
              <button onClick={async () => addFiles(await api.chooseFiles())} title="Attach files" className="shrink-0 w-8 h-8 rounded-full text-muted hover:text-ink hover:bg-sunken grid place-items-center">
                <Paperclip size={16} />
              </button>
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
                onPaste={onPaste}
                rows={1}
                placeholder={isCentral ? 'Ask, / for an agent, @ for a file…' : `Message ${agent?.name ?? 'agent'}… (/ for an agent, @ for a file)`}
                className="flex-1 bg-transparent outline-none resize-none text-[15px] leading-6 py-1 placeholder:text-faint"
              />
              {agent && <ModelPicker agent={agent} override={a.chatModels[agent.id]} />}
              <button
                onClick={send}
                disabled={(!text.trim() && !files.length) || sending}
                title="Send"
                className="shrink-0 w-8 h-8 rounded-full bg-accent text-white grid place-items-center disabled:opacity-30 hover:opacity-90"
              >
                <ArrowUp size={16} />
              </button>
              </div>
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
        {run.input.attachments && <FileChips files={run.input.attachments} className="mb-1.5" />}
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

function Message({ m, agentIds, name, origin, run, onRetry, canRetry, proposals, backTo }: { m: ChatMessage; agentIds: Set<string>; name: string; origin: string; run?: Run; onRetry: () => Promise<unknown>; canRetry: boolean; proposals: Action[]; backTo?: { key: string; name: string } }) {
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
        <div className="max-w-[85%] rounded-3xl bg-sunken px-4 py-2.5 text-[15px] leading-6 whitespace-pre-wrap">
          {m.files && <FileChips files={m.files} className="mb-1.5" />}
          {withTags(m.text, agentIds)}
        </div>
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
            ? 'Type / and pick one of your agents to give it work directly, or write a goal and your coordinator will split it between them.'
            : 'Create an agent first, then use / here to give it work or let a coordinator split goals between several.'
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
