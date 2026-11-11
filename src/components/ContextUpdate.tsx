import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Loader2, Undo2, Wand2 } from 'lucide-react'
import type { ContextResult } from '@shared/types'
import { api } from '@/lib/api'
import { useStore } from '@/store/app'
import { lineDiff } from '@/lib/diff'
import { Button, Modal } from './ui'

const EXAMPLES = [
  'I dropped DMS this semester; keep only RTAI and AI in Education.',
  'Thesis submission moved to 15 March 2027.',
  'Priority this month: internship applications before master’s research.'
]

type Phase = 'write' | 'running' | 'review' | 'error'

/**
 * Free-text context update: the instruction goes to Claude Code / Codex, which edits the
 * vault following 03_Workflows/context-maintenance.md. Nothing is kept until you say so.
 */
export function ContextUpdate({ onClose }: { onClose: () => void }) {
  const engine = useStore((s) => s.state?.settings.contextEngine ?? 'codex')
  const toast = useStore((s) => s.toast)
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<Phase>('write')
  const [progress, setProgress] = useState<string[]>([])
  const [result, setResult] = useState<ContextResult | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => window.api.onProgress((line) => setProgress((p) => (p.at(-1) === line ? p : [...p, line]))), [])

  const submit = async () => {
    if (!text.trim()) return
    setPhase('running')
    setProgress([])
    try {
      const r = await api.contextUpdate(text.trim())
      setResult(r)
      setOpen(new Set(r.changes.slice(0, 1).map((c) => c.path)))
      setPhase('review')
    } catch (e) {
      setError((e as Error).message)
      setPhase('error')
    }
  }

  const keep = async () => {
    await api.contextKeep()
    toast(`Context updated in ${result!.changes.length} file${result!.changes.length === 1 ? '' : 's'}`)
    onClose()
  }
  const undo = async () => {
    const skipped = await api.contextUndo()
    toast(
      skipped.length
        ? `Undone, except ${skipped.join(', ')}: changed since in a way that can't be separated from the AI's edit, so left as is (the diff above shows what it did).`
        : 'Changes undone. The files are back to how they were.'
    )
    onClose()
  }

  // While a run or an unreviewed result exists, closing must not silently keep edits.
  const close = () => {
    if (phase === 'running') return
    if (phase === 'review' && result?.changes.length) return
    onClose()
  }

  return (
    <Modal onClose={close} width="max-w-2xl">
      <div className="p-5 border-b border-line flex items-start gap-3">
        <Wand2 size={18} className="text-accent mt-0.5" />
        <div>
          <h2 className="text-[15px] font-semibold">Update context</h2>
          <p className="text-[12px] text-muted mt-0.5">
            Say what changed. {engine === 'codex' ? 'Codex (GPT-5.6 Luna)' : 'Claude Code (Haiku 5.5)'} updates the right files using your context-maintenance workflow. You review the
            changes before anything is kept.
          </p>
        </div>
      </div>

      {phase === 'write' && (
        <div className="p-5">
          <textarea
            ref={box}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.metaKey && submit()}
            rows={5}
            placeholder="e.g. I dropped DMS this semester…"
            className="w-full px-3 py-2.5 rounded-lg border border-line bg-bg text-[13.5px] leading-relaxed outline-none focus:border-accent resize-none"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => (setText(ex), box.current?.focus())} className="px-2 py-1 rounded-md bg-sunken text-[11.5px] text-muted hover:text-ink text-left">
                {ex}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button kind="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button kind="primary" onClick={submit} disabled={!text.trim()}>
              <Wand2 size={13} /> Update context ⌘↵
            </Button>
          </div>
        </div>
      )}

      {phase === 'running' && (
        <div className="p-5">
          <div className="text-[12.5px] bg-sunken rounded-md px-3 py-2 mb-3 italic text-muted">“{text}”</div>
          <div className="flex items-center gap-2 text-[12.5px]">
            <Loader2 size={14} className="animate-spin text-accent" /> Working…
          </div>
          <div className="mt-2 max-h-48 overflow-y-auto font-mono text-[11.5px] text-muted">
            {progress.map((p, i) => (
              <div key={i}>{p}</div>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <Button kind="ghost" onClick={() => api.contextCancel()}>
              Stop (undo everything)
            </Button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="p-5">
          <div className="text-danger text-[12.5px]">{error}</div>
          <p className="text-[12px] text-muted mt-1">Any partial edits were reverted.</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button kind="ghost" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => setPhase('write')}>Try again</Button>
          </div>
        </div>
      )}

      {phase === 'review' && result && (
        <div>
          <div className="max-h-[52vh] overflow-y-auto">
          <div className="px-5 pt-4 text-[12.5px] whitespace-pre-wrap leading-relaxed">{result.summary || 'Done.'}</div>
          {result.changes.length === 0 ? (
            <div className="px-5 py-4 text-[12.5px] text-muted">No files were changed.</div>
          ) : (
            <div className="px-5 py-4">
              {result.changes.map((c) => {
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
            </div>
          )}
          </div>
          <div className="p-4 border-t border-line flex justify-end gap-2">
            {result.changes.length ? (
              <>
                <Button kind="ghost" onClick={undo}>
                  <Undo2 size={13} /> Undo all
                </Button>
                <Button kind="primary" onClick={keep}>
                  <Check size={13} /> Keep changes
                </Button>
              </>
            ) : (
              <Button onClick={onClose}>Close</Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
