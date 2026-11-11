import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import type { Task } from '@shared/types'
import { fmtDuration } from '@shared/time'
import { useStore } from '@/store/app'
import { categoryOf, cx } from '@/lib/util'
import { TaskTree } from '@/components/TaskRow'
import { QuickAdd } from '@/components/QuickAdd'
import { Dot, Header } from '@/components/ui'

export function Tasks() {
  const s = useStore((st) => st.state)!
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState<string | null>(null)
  const byId = useMemo(() => new Map(s.vault.tasks.map((t) => [t.id, t])), [s.vault.tasks])

  const matches = (t: Task): boolean => {
    if (!showDone && t.done) return false
    if (cat && t.category !== cat) return false
    if (!query) return true
    const q = query.toLowerCase()
    return t.title.toLowerCase().includes(q) || t.childIds.some((id) => byId.get(id) && matches(byId.get(id)!))
  }

  const open = s.vault.tasks.filter((t) => !t.done)
  const totalMin = (ts: Task[]) => ts.reduce((a, t) => a + (t.childIds.length ? 0 : t.estimateMin ?? categoryOf(s, t.category).defaultEstimateMinutes), 0)

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Header title="Tasks" sub={`${open.length} open · ${fmtDuration(totalMin(open))} estimated · from 05_Tasks/daily-todos.md`}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="h-7 w-52 px-2.5 rounded-md bg-sunken text-[12.5px] outline-none placeholder:text-faint"
        />
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done
        </label>
      </Header>
      <div className="px-5 py-2 border-b border-line flex gap-1.5 flex-wrap">
        <button onClick={() => setCat(null)} className={cx('px-2.5 h-6 rounded-full text-[11.5px] border', !cat ? 'bg-ink text-bg border-ink' : 'border-line text-muted')}>
          All
        </button>
        {s.vault.preferences.categories.map((c) => {
          const n = open.filter((t) => t.category === c.key).length
          if (!n) return null
          return (
            <button
              key={c.key}
              onClick={() => setCat(cat === c.key ? null : c.key)}
              className={cx('px-2.5 h-6 rounded-full text-[11.5px] border flex items-center gap-1.5', cat === c.key ? 'border-ink' : 'border-line text-muted')}
            >
              <Dot color={c.color} /> {c.label} <span className="text-faint">{n}</span>
            </button>
          )
        })}
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-5 py-4">
          <QuickAdd />
          {s.vault.sections.map((sec) => {
            const key = sec.path.join('>')
            const roots = sec.taskIds.map((id) => byId.get(id)!).filter((t) => t && matches(t))
            if (!roots.length && (query || cat)) return null
            const isCollapsed = collapsed.has(key)
            const depth = sec.path.length - 1
            const c = categoryOf(s, sec.category)
            return (
              <section key={key} className="mt-4" style={{ marginLeft: depth * 14 }}>
                <div className="group flex items-center gap-1.5 py-1">
                  <button
                    onClick={() => {
                      const n = new Set(collapsed)
                      if (n.has(key)) n.delete(key)
                      else n.add(key)
                      setCollapsed(n)
                    }}
                    className="flex items-center gap-1.5 text-left"
                  >
                    {isCollapsed ? <ChevronRight size={13} className="text-faint" /> : <ChevronDown size={13} className="text-faint" />}
                    <span className={cx('font-semibold', depth ? 'text-[12.5px]' : 'text-[13.5px]')}>{sec.path[sec.path.length - 1]}</span>
                  </button>
                  <Dot color={c.color} className="ml-1" />
                  <span className="text-[11px] text-faint">{roots.filter((t) => !t.done).length || ''}</span>
                  <button onClick={() => setAdding(key)} className="ml-1 text-faint hover:text-ink opacity-0 group-hover:opacity-100" title="Add task here">
                    <Plus size={13} />
                  </button>
                </div>
                {!isCollapsed && (
                  <div>
                    {roots.map((t) => (
                      <TaskTree key={t.id} task={t} showDone={showDone} reorderable />
                    ))}
                    {adding === key && <QuickAdd section={sec.path} autoFocus placeholder={`Add to ${sec.path.join(' › ')}…`} onDone={() => setAdding(null)} />}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
