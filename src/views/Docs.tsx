import { useEffect, useState } from 'react'
import type { DocInfo } from '@shared/types'
import { ABOUT_ME_FILE, GOALS_FILE, PRIORITIES_FILE } from '@shared/paths'
import { api } from '@/lib/api'
import { useStore } from '@/store/app'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cx } from '@/lib/util'
import { DocEditor } from '@/components/DocEditor'
import { Empty } from '@/components/ui'

const PINNED = [PRIORITIES_FILE, GOALS_FILE, ABOUT_ME_FILE]

export function Docs() {
  const { docPath, openDoc } = useStore()
  const [docs, setDocs] = useState<DocInfo[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    void api.listDocs().then(setDocs)
  }, [])

  const groups = new Map<string, DocInfo[]>()
  for (const d of docs.filter((d) => !query || d.title.toLowerCase().includes(query.toLowerCase()) || d.path.toLowerCase().includes(query.toLowerCase())))
    groups.set(d.group, [...(groups.get(d.group) ?? []), d])
  const pinned = PINNED.map((p) => docs.find((d) => d.path === p)).filter((d): d is DocInfo => Boolean(d))

  return (
    <div className="flex-1 min-h-0 flex">
      <aside className="w-64 @max-4xl:w-48 shrink-0 border-r border-line/50 flex flex-col min-h-0">
        <div className="drag-region h-14 shrink-0 flex items-end px-3 pb-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a doc…"
            className="no-drag w-full h-8 px-3 rounded-lg bg-sunken text-[12.5px] outline-none placeholder:text-faint"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {!query && pinned.length > 0 && <Group title="Quick access" docs={pinned} active={docPath} onOpen={openDoc} />}
          {[...groups].map(([g, list]) => (
            <Group key={g} title={g} docs={list} active={docPath} onOpen={openDoc} collapsible forceOpen={Boolean(query)} />
          ))}
        </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col bg-panel">
        <div className="drag-region h-5 shrink-0" />
        {docPath ? <DocEditor key={docPath} path={docPath} /> : <Empty>Pick a document to edit: your priorities, profile, projects or context.</Empty>}
      </div>
    </div>
  )
}

function Group({ title, docs, active, onOpen, collapsible, forceOpen }: { title: string; docs: DocInfo[]; active: string | null; onOpen: (p: string) => void; collapsible?: boolean; forceOpen?: boolean }) {
  const hasActive = docs.some((d) => d.path === active)
  const [open, setOpen] = useState(false)
  const shown = !collapsible || open || hasActive || forceOpen
  return (
    <div className="mt-2">
      {collapsible ? (
        <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-1 px-2 py-1 text-[12px] text-faint hover:text-ink">
          {shown ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {title} <span className="ml-auto text-[11px]">{docs.length}</span>
        </button>
      ) : (
        <h3 className="px-2 text-[12px] text-faint mb-0.5">{title}</h3>
      )}
      {shown && docs.map((d) => (
        <button
          key={title + d.path}
          onClick={() => onOpen(d.path)}
          className={cx('w-full text-left px-2.5 py-1.5 rounded-lg text-[12.5px] truncate', active === d.path ? 'bg-accent-soft text-accent font-medium' : 'hover:bg-sunken')}
          title={d.path}
        >
          {d.title}
        </button>
      ))}
    </div>
  )
}
