import { useEffect, useRef, useState } from 'react'
import { Loader2, Pause, RotateCcw, Send } from 'lucide-react'
import type { AgentDef } from '@shared/agents'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { cx } from '@/lib/util'
import { Button, Modal } from './ui'

/**
 * Multi-turn chat with one custom agent. Each message is a run on the agent's own conversation (Claude --resume,
 * Codex exec resume), so it queues, respects the budget pause and, for propose/act agents, is reviewed like any run.
 */
export function AgentChat({ def, onClose }: { def: AgentDef; onClose: () => void }) {
  const a = useStore((st) => st.state)!.agents
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const messages = a.chats[def.id] ?? []
  const run = [...a.runs].reverse().find((r) => r.agentId === def.id && r.chat)
  const working = run && ['queued', 'paused', 'running'].includes(run.status)
  const failed = run?.status === 'error' || run?.status === 'cancelled' ? run : undefined

  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [messages.length, working, run?.progress.length])

  const send = async () => {
    const t = text.trim()
    if (!t || working) return
    setText('')
    await act(api.chatSend(def.id, t))
  }

  return (
    <Modal onClose={onClose} width="max-w-2xl">
      <div className="flex flex-col max-h-[78vh]">
        <div className="p-4 border-b border-line flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-semibold truncate">Chat with {def.name}</h2>
            <p className="text-[11.5px] text-muted">
              {def.permission === 'read' ? 'Read-only: it can look at your files and answer.' : 'It may edit files; you review the changes in the Agents view (Keep or Undo).'} Actions it proposes wait for your OK.
            </p>
          </div>
          <Button kind="ghost" title="Forget this conversation" onClick={() => act(api.chatReset(def.id), 'Conversation cleared')} disabled={!messages.length || Boolean(working)}>
            <RotateCcw size={13} /> New chat
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-40">
          {!messages.length && !working && <div className="text-[12.5px] text-faint">Ask anything. The conversation continues across messages until you start a new chat.</div>}
          {messages.map((m, i) => (
            <div key={i} className={cx('flex', m.role === 'user' && 'justify-end')}>
              <div className={cx('max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap', m.role === 'user' ? 'bg-accent text-white' : 'bg-sunken')}>{m.text || '(no text)'}</div>
            </div>
          ))}
          {working && run && (
            <div className="space-y-1">
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-xl px-3 py-2 text-[13px] bg-accent/70 text-white whitespace-pre-wrap">{run.input.text}</div>
              </div>
              <div className="flex items-center gap-2 text-[12px] text-muted">
                {run.status === 'paused' ? <Pause size={12} className="text-warn" /> : <Loader2 size={12} className="animate-spin text-accent" />}
                {run.status === 'paused' ? `Paused: ${run.pauseReason} Decide in the Agents view.` : run.status === 'queued' ? 'Waiting for the run before it…' : (run.progress.at(-1) ?? 'Thinking…')}
              </div>
            </div>
          )}
          {failed && !working && messages.at(-1)?.runId !== failed.id && <div className="text-[12px] text-danger">{failed.error ?? failed.status}: that message wasn't answered. You can send it again.</div>}
          <div ref={end} />
        </div>
        <div className="p-3 border-t border-line flex gap-2 items-end">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            rows={2}
            placeholder={working ? 'Waiting for the answer…' : 'Message (Enter to send, Shift+Enter for a new line)'}
            className="flex-1 px-3 py-2 rounded-lg border border-line bg-bg text-[13px] outline-none focus:border-accent resize-none"
          />
          <Button kind="primary" onClick={send} disabled={!text.trim() || Boolean(working)}>
            <Send size={13} /> Send
          </Button>
        </div>
      </div>
    </Modal>
  )
}
