import { useEffect, useState } from 'react'
import type { DocInfo } from '@shared/types'
import { api } from '@/lib/api'
import { useStore } from '@/store/app'
import { cx } from '@/lib/util'
import { DocEditor } from '@/components/DocEditor'
import { Empty } from '@/components/ui'

const PINNED = ['04_Context_Docs/current-priorities.md', '04_Context_Docs/goals-and-direction.md', '01_Profile/personal-context.md']

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
      <aside className="w-64 shrink-0 border-r border-line flex flex-col min-h-0">
        <div className="drag-region h-14 shrink-0 flex items-end px-3 pb-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a doc…"
            className="no-drag w-full h-7 px-2.5 rounded-md bg-sunken text-[12.5px] outline-none placeholder:text-faint"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {!query && pinned.length > 0 && <Group title="Quick access" docs={pinned} active={docPath} onOpen={openDoc} />}
          {[...groups].map(([g, list]) => (
            <Group key={g} title={g} docs={list} active={docPath} onOpen={openDoc} />
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

function Group({ title, docs, active, onOpen }: { title: string; docs: DocInfo[]; active: string | null; onOpen: (p: string) => void }) {
  return (
    <div className="mt-3">
      <h3 className="px-2 text-[11px] uppercase tracking-wide text-faint mb-0.5">{title}</h3>
      {docs.map((d) => (
        <button
          key={title + d.path}
          onClick={() => onOpen(d.path)}
          className={cx('w-full text-left px-2 py-1 rounded-md text-[12.5px] truncate', active === d.path ? 'bg-accent-soft text-accent font-medium' : 'hover:bg-sunken')}
          title={d.path}
        >
          {d.title}
        </button>
      ))}
    </div>
  )
}
