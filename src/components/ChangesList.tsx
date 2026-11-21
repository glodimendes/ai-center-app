import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ContextChange } from '@shared/types'
import { lineDiff } from '@/lib/diff'

/** Per-file diff of what an AI run changed; the first file starts open. */
export function ChangesList({ changes }: { changes: ContextChange[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set(changes.slice(0, 1).map((c) => c.path)))
  return (
    <>
      {changes.map((c) => {
        const isOpen = open.has(c.path)
        const diff = lineDiff(c.before ?? '', c.after).filter((l) => l.kind !== 'same')
        return (
          <div key={c.path} className="border border-line rounded-md mb-2">
            <button
              onClick={() => {
                const n = new Set(open)
                if (n.has(c.path)) n.delete(c.path)
                else n.add(c.path)
                setOpen(n)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left"
            >
              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span className="font-medium flex-1 truncate">{c.path}</span>
              {c.before === null && <span className="text-ok text-[11px]">new file</span>}
              <span className="text-ok text-[11px]">+{diff.filter((l) => l.kind === 'add').length}</span>
              <span className="text-danger text-[11px]">−{diff.filter((l) => l.kind === 'del').length}</span>
            </button>
            {isOpen && (
              <pre className="border-t border-line text-[11.5px] leading-relaxed p-2 font-mono whitespace-pre-wrap">
                {diff.map((l, i) => (
                  <div key={i} className={l.kind === 'add' ? 'text-ok bg-ok/10' : 'text-danger bg-danger/10'}>
                    {l.kind === 'add' ? '+ ' : '− '}
                    {l.text || ' '}
                  </div>
                ))}
              </pre>
            )}
          </div>
        )
      })}
    </>
  )
}
