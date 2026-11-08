import { useState } from 'react'
import { ArrowRight, Trash2 } from 'lucide-react'
import type { InboxItem } from '@shared/types'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { Button, Empty, Header } from '@/components/ui'

export function InboxView() {
  const s = useStore((st) => st.state)!
  const [text, setText] = useState('')
  const byDate = new Map<string, InboxItem[]>()
  for (const i of [...s.vault.inbox].reverse()) byDate.set(i.date ?? '', [...(byDate.get(i.date ?? '') ?? []), i])

  const capture = async () => {
    if (!text.trim()) return
    await act(api.addInbox(text.trim()))
    setText('')
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Header title="Inbox" sub="Braindump: raw ideas from 05_Tasks/braindump-inbox.md. Triage them into tasks. ⌘⇧Space captures from anywhere while the app is open." />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-5">
          <div className="flex gap-2">
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && capture()}
              placeholder="Capture a thought…"
              className="flex-1 h-9 px-3 rounded-lg border border-line bg-panel text-[13.5px] outline-none focus:border-accent"
            />
            <Button kind="primary" onClick={capture} className="h-9">
              Capture
            </Button>
          </div>
          {!s.vault.inbox.length && <Empty>Inbox is empty.</Empty>}
          {[...byDate].map(([date, items]) => (
            <section key={date} className="mt-6">
              <h3 className="text-[11px] uppercase tracking-wide text-faint mb-1">{date}</h3>
              {items.map((i) => (
                <Item key={i.id} item={i} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

function Item({ item }: { item: InboxItem }) {
  const sections = useStore((st) => st.state!.vault.sections)
  const [moving, setMoving] = useState(false)
  const [text, setText] = useState(item.text.replace(/\.$/, ''))
  const [target, setTarget] = useState(sections[0]?.path.join('>') ?? '')
  return (
    <div className="group py-1.5 px-2 -mx-2 rounded-md hover:bg-sunken/70">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[13px]">
          {item.text}
          {item.topic && <span className="ml-2 text-[11px] text-faint">{item.topic}</span>}
        </span>
        <Button kind="ghost" onClick={() => setMoving(!moving)} className="opacity-0 group-hover:opacity-100">
          <ArrowRight size={13} /> Make task
        </Button>
        <Button kind="danger" onClick={() => act(api.removeInbox(item.id))} className="opacity-0 group-hover:opacity-100" title="Remove">
          <Trash2 size={13} />
        </Button>
      </div>
      {moving && (
        <div className="flex gap-2 mt-2">
          <input value={text} onChange={(e) => setText(e.target.value)} className="flex-1 h-7 px-2 rounded border border-line bg-bg text-[12.5px]" />
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-7 px-1 rounded border border-line bg-bg text-[12px] max-w-56">
            {sections.map((s) => (
              <option key={s.path.join('>')} value={s.path.join('>')}>
                {s.path.join(' › ')}
              </option>
            ))}
          </select>
          <Button kind="primary" onClick={() => act(api.inboxToTask(item.id, text, target.split('>')), 'Moved to tasks')}>
            Move
          </Button>
        </div>
      )}
    </div>
  )
}
