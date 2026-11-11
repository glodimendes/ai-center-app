import { useState } from 'react'
import { ArrowRight, Check, Trash2 } from 'lucide-react'
import type { InboxItem, Task } from '@shared/types'
import { categoryOf, inlineMd } from '@/lib/util'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { Button, Dot, Empty, Header } from '@/components/ui'

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
        <div className="max-w-3xl mx-auto px-5 @max-3xl:px-3 py-5">
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
          <NewTasks />
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
        <span className="flex-1 min-w-0 break-words text-[13px]">
          {item.text}
          {item.topic && <span className="ml-2 text-[11px] text-faint">{item.topic}</span>}
        </span>
        <Button kind="ghost" onClick={() => setMoving(!moving)} label="Make task" className="opacity-0 group-hover:opacity-100">
          <ArrowRight size={13} />
        </Button>
        <Button kind="danger" onClick={() => act(api.removeInbox(item.id))} className="opacity-0 group-hover:opacity-100" title="Remove">
          <Trash2 size={13} />
        </Button>
      </div>
      {moving && (
        <div className="flex flex-wrap gap-2 mt-2">
          <input value={text} onChange={(e) => setText(e.target.value)} className="flex-1 min-w-48 h-7 px-2 rounded border border-line bg-bg text-[12.5px]" />
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-7 px-1 rounded border border-line bg-bg text-[12px] min-w-0 max-w-56">
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

/**
 * Tasks that showed up in daily-todos.md from outside the app (the meeting-review automation, Codex,
 * an edit in Obsidian). Keep them, or delete the line, one by one.
 */
function NewTasks() {
  const s = useStore((st) => st.state)!
  const tasks = s.newTaskIds.map((id) => s.vault.tasks.find((t) => t.id === id)).filter((t): t is Task => Boolean(t))
  if (!tasks.length) return null
  return (
    <section className="mt-6 rounded-lg border border-accent/40 bg-accent-soft/40 p-3">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h3 className="text-[13px] font-semibold flex-1 min-w-0">New in your todo list</h3>
        <Button onClick={() => act(api.acknowledgeTasks(tasks.map((t) => t.id)), 'All kept')}>
          <Check size={13} /> Keep all
        </Button>
      </div>
      <p className="text-[11.5px] text-muted mb-2">Added outside the app (e.g. by the meeting-review automation, Codex or an edit in Obsidian; a renamed task shows up here too).</p>
      {tasks.map((t) => (
        <div key={t.id} className="group flex items-center gap-2 py-1 min-w-0">
          <Dot color={categoryOf(s, t.category).color} />
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] break-words" dangerouslySetInnerHTML={{ __html: inlineMd(t.title) }} />
            <span className="block text-[11px] text-faint truncate">{t.section.join(' › ')}</span>
          </span>
          <Button kind="ghost" onClick={() => act(api.acknowledgeTasks([t.id]))} label="Keep">
            <Check size={13} />
          </Button>
          <Button kind="danger" onClick={() => act(api.deleteTask(t.id), 'Deleted from daily-todos.md')} title="Delete this line">
            <Trash2 size={13} />
          </Button>
        </div>
      ))}
    </section>
  )
}

