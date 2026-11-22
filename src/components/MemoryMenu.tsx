import { useEffect, useState } from 'react'
import { Brain } from 'lucide-react'
import type { AgentDef } from '@shared/agents'
import { api } from '@/lib/api'
import { act } from '@/store/app'
import { cx } from '@/lib/util'
import { Button, Popover } from './ui'

/**
 * The agent's memory, from its own chat: switch it on, read what it has kept, edit or clear it.
 * Notes arrive while it works (kept at once, with Undo under the answer); this is the place to tidy them.
 */
export function MemoryMenu({ agent }: { agent: AgentDef }) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState<string | null>(null)
  const [edited, setEdited] = useState(false)
  useEffect(() => {
    if (!open || !agent.memory) return
    setNotes(null)
    setEdited(false)
    api.agentMemory(agent.id).then(setNotes, () => setNotes(''))
  }, [open, agent.memory, agent.id])
  const lines = notes?.split('\n').filter((l) => l.trim()).length ?? 0
  return (
    <span className="no-drag relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        title={agent.memory ? 'Its notes between chats' : 'Let it remember things between chats'}
        className={cx('flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[12px] hover:text-ink', agent.memory ? 'text-accent' : 'text-muted')}
      >
        <Brain size={13} className="shrink-0" />
        <span>Memory</span>
        {agent.memory && notes !== null && lines > 0 && <span className="text-faint">{lines}</span>}
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} align="right" className="w-96">
          <label className="flex items-center gap-2 px-2.5 py-1.5 text-[13px]">
            <input type="checkbox" checked={Boolean(agent.memory)} onChange={(e) => act(api.saveAgent({ ...agent, memory: e.target.checked || undefined }))} />
            <span className="flex-1">Remember things between chats</span>
          </label>
          {!agent.memory ? (
            <div className="px-2.5 pb-2 text-[12px] text-faint">Off. Switch it on and {agent.name} can keep notes about how you like things done and what it learns while it works. The chat continues with a fresh session that knows its notes.</div>
          ) : (
            <div className="px-2.5 pb-2">
              <textarea
                value={notes ?? ''}
                disabled={notes === null}
                onChange={(e) => (setNotes(e.target.value), setEdited(true))}
                rows={7}
                placeholder="Nothing remembered yet. When it notices something worth keeping, it appears here and under its answer."
                className="w-full px-2.5 py-2 rounded-lg border border-line bg-bg text-[12px] font-mono outline-none focus:border-accent resize-none"
              />
              <div className="mt-1.5 flex items-center gap-2">
                <span className="flex-1 text-[11.5px] text-faint">One note per line. Kept at once, shown under its answer with Undo.</span>
                <Button kind="ghost" disabled={!notes} onClick={() => (setNotes(''), setEdited(true))}>
                  Clear
                </Button>
                <Button
                  kind="primary"
                  disabled={!edited}
                  onClick={() => act(api.saveAgentMemory(agent.id, notes ?? '').then(() => setEdited(false)), 'Memory saved')}
                >
                  Save
                </Button>
              </div>
            </div>
          )}
        </Popover>
      )}
    </span>
  )
}
