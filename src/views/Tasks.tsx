import { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Plus, Sparkles } from 'lucide-react'
import type { Task } from '@shared/types'
import { fmtDuration } from '@shared/time'
import { useStore } from '@/store/app'
import { askerName, categoryOf, cx, relDay } from '@/lib/util'
import { projection } from '@/lib/plan'
import { TASK_VIEW_SORTS } from '@/lib/taskSort'
import { TaskTree } from '@/components/TaskRow'
import { QuickAdd } from '@/components/QuickAdd'
import { Button, Dot, Header, MoreMenu } from '@/components/ui'
import { EstimateSuggestions } from '@/components/EstimateSuggestions'

export function Tasks() {
  const s = useStore((st) => st.state)!
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState<string | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  // View-only: never rewrites the file. Only the tasks inside a heading are ordered; headings keep their nesting and order.
  const [sort, setSort] = useState<string>(() => {
    try {
      const k = localStorage.getItem('tasks-sort')
      return TASK_VIEW_SORTS.some((x) => x.key === k) ? (k as string) : 'file'
    } catch {
      return 'file'
    }
  })
  const pickSort = (k: string) => {
    setSort(k)
    try {
      localStorage.setItem('tasks-sort', k)
    } catch {
      /* per-device convenience only */
    }
  }
  const cmp = TASK_VIEW_SORTS.find((x) => x.key === sort)?.cmp(s)
  const byId = useMemo(() => new Map(s.vault.tasks.map((t) => [t.id, t])), [s.vault.tasks])

  const matches = (t: Task): boolean => {
    if (!showDone && t.done) return false
    if (cat && t.category !== cat) return false
    if (!query) return true
    const q = query.toLowerCase()
    return t.title.toLowerCase().includes(q) || t.childIds.some((id) => byId.get(id) && matches(byId.get(id)!))
  }

  const open = s.vault.tasks.filter((t) => !t.done)
  const openIds = new Set(open.map((t) => t.id))
  const noEstimate = open.filter((t) => !t.estimateMin && !t.childIds.some((id) => openIds.has(id))).length
  const totalMin = (ts: Task[]) => ts.reduce((a, t) => a + (t.childIds.length ? 0 : t.estimateMin ?? categoryOf(s, t.category).defaultEstimateMinutes), 0)

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Header title="Tasks" sub={`${open.length} open · ${fmtDuration(totalMin(open))} estimated`}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="h-8 w-52 @max-4xl:w-36 @max-2xl:w-28 px-3 rounded-lg bg-sunken text-[12.5px] outline-none placeholder:text-faint"
        />
        {noEstimate > 0 && (
          <Button kind="ghost" onClick={() => setSuggesting(true)} label={`Suggest ${noEstimate} estimates`} title={`${askerName(s.settings.askEngine)} suggests estimates for ${noEstimate} open tasks without one; you pick which to keep`}>
            <Sparkles size={13} className="text-accent" />
          </Button>
        )}
        <MoreMenu items={[{ label: showDone ? 'Hide done tasks' : 'Show done tasks', icon: <Check size={14} />, onClick: () => setShowDone(!showDone) }]} />
      </Header>
      <div className="px-6 @max-3xl:px-3 py-2.5 border-b border-line/50 flex gap-1.5 flex-wrap">
        <button onClick={() => setCat(null)} className={cx('px-3 h-7 rounded-full text-[12px]', !cat ? 'bg-accent text-white' : 'bg-sunken text-muted hover:text-ink')}>
          All
        </button>
        {s.vault.preferences.categories.map((c) => {
          const n = open.filter((t) => t.category === c.key).length
          if (!n) return null
          return (
            <button
              key={c.key}
              onClick={() => setCat(cat === c.key ? null : c.key)}
              className={cx('px-3 h-7 rounded-full text-[12px] flex items-center gap-1.5', cat === c.key ? 'bg-accent-soft text-accent font-medium' : 'bg-sunken text-muted hover:text-ink')}
            >
              <Dot color={c.color} /> {c.label} <span className="text-faint">{n}</span>
            </button>
          )
        })}
        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-faint" title="Orders the tasks inside each heading. Headings and the file stay as they are.">
          Sort
          <select value={sort} onChange={(e) => pickSort(e.target.value)} className="h-7 px-2 rounded-lg bg-sunken text-[12px] text-ink outline-none">
            <option value="file">As in the file</option>
            {TASK_VIEW_SORTS.filter((x) => x.key !== 'file').map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-5 @max-3xl:px-2 py-4">
          <QuickAdd />
          {s.vault.sections.map((sec) => {
            const key = sec.path.join('>')
            const roots = sec.taskIds.map((id) => byId.get(id)!).filter((t) => t && matches(t))
            if (cmp) roots.sort(cmp) // stable: ties keep their file order
            if (!roots.length && (query || cat)) return null
            // a collapsed parent heading (ETH) hides its sub-headings too
            if ([...collapsed].some((k) => key.startsWith(k + '>'))) return null
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
                  <Eta tasks={s.vault.tasks.filter((t) => t.section.join('>') === key || t.section.join('>').startsWith(key + '>'))} />
                  <button onClick={() => setAdding(key)} className="ml-1 text-faint hover:text-ink opacity-0 group-hover:opacity-100" title="Add task here">
                    <Plus size={13} />
                  </button>
                </div>
                {!isCollapsed && (
                  <div>
                    {roots.map((t) => (
                      <TaskTree key={t.id} task={t} showDone={showDone} reorderable={sort === 'file'} />
                    ))}
                    {adding === key && <QuickAdd section={sec.path} autoFocus placeholder={`Add to ${sec.path.join(' › ')}…`} onDone={() => setAdding(null)} />}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </div>
      {suggesting && <EstimateSuggestions onClose={() => setSuggesting(false)} />}
    </div>
  )
}

/** A heading's projected finish from the current plan, and what won't make it. */
function Eta({ tasks }: { tasks: Task[] }) {
  const s = useStore((st) => st.state)!
  const p = projection(s, tasks)
  if (!p.open) return null
  return (
    <>
      {p.late > 0 && <span className="ml-1 text-[11px] text-warn">{p.late} late</span>}
      <span className="ml-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-faint opacity-0 group-hover:opacity-100 transition-opacity" title="When the last planned task under this heading finishes, in the current plan">
        {p.finish && <span>→ {relDay(p.finish.slice(0, 10))}</span>}
        {p.unplanned > 0 && <span>{p.unplanned} not planned</span>}
      </span>
    </>
  )
}
