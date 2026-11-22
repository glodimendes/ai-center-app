import { useEffect, useState } from 'react'
import { BookOpen, Wand2 } from 'lucide-react'
import { PRIORITIES_FILE } from '@shared/paths'
import { api } from '@/lib/api'
import { useStore } from '@/store/app'
import { inlineMd } from '@/lib/util'
import { Button } from '@/components/ui'

const PATH = PRIORITIES_FILE

/** The ranked list under the "priorities" heading (numbered or bulleted), plus the doc's "Last updated". */
export function parsePriorities(md: string): { items: string[]; updated?: string } {
  const lines = md.split('\n')
  const at = lines.findIndex((l) => /^##\s.*priorit/i.test(l))
  const items: string[] = []
  if (at >= 0) {
    for (const l of lines.slice(at + 1)) {
      if (/^#{1,6}\s/.test(l)) break
      const m = l.match(/^\s{0,3}(?:\d+[.)]|[-*])\s+(.+)$/)
      if (m) items.push(m[1].trim())
    }
  }
  return { items, updated: md.match(/^Last updated:\s*(\S+)/im)?.[1] }
}

/** Review's right side: the priorities as a short ranked list, so nobody has to read the file. Update context keeps the file current. */
export function PrioritiesPanel() {
  const vaultState = useStore((s) => s.state)
  const openDoc = useStore((s) => s.openDoc)
  const [data, setData] = useState<{ items: string[]; updated?: string } | null | 'missing'>(null)

  useEffect(() => {
    let live = true
    api.readDoc(PATH).then(
      (d) => live && setData(parsePriorities(d.content)),
      () => live && setData('missing')
    )
    return () => {
      live = false
    }
  }, [vaultState])

  const ask = (text: string) => window.dispatchEvent(new CustomEvent('open-context-update', { detail: text }))

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-[14px] font-semibold flex-1">Priorities</h2>
        {data && data !== 'missing' && data.updated && <span className="text-[11.5px] text-faint">updated {data.updated}</span>}
      </div>
      {data === 'missing' && <p className="text-[12.5px] text-muted">No priorities yet. Describe them in “Update context” and they will be written to {PATH}.</p>}
      {data && data !== 'missing' && !data.items.length && <p className="text-[12.5px] text-muted">The priorities doc has no list yet. Ask “Update context” to write one.</p>}
      {data && data !== 'missing' && (
        <ol className="flex flex-col gap-2">
          {data.items.map((t, i) => (
            <li key={i} className="flex items-start gap-3 rounded-xl border border-line/60 bg-bg px-3.5 py-3">
              <span className="shrink-0 w-6 h-6 rounded-full grid place-items-center text-[12px] font-semibold bg-accent-soft text-accent">{i + 1}</span>
              <span className="text-[13.5px] leading-snug pt-0.5 min-w-0 break-words" dangerouslySetInnerHTML={{ __html: inlineMd(t) }} />
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap gap-2 mt-4">
        <Button kind="primary" onClick={() => ask('Update my current priorities. Check my recent changes and tasks, and re-rank or reword the list if needed.')}>
          <Wand2 size={13} /> Update priorities
        </Button>
        <Button kind="ghost" onClick={() => openDoc(PATH)} title="Open the full document in Docs">
          <BookOpen size={13} /> Open doc
        </Button>
      </div>
    </div>
  )
}
