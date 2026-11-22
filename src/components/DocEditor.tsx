import { useCallback, useEffect, useRef, useState } from 'react'
import { Crepe } from '@milkdown/crepe'
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import { FolderOpen, Loader2 } from 'lucide-react'
import type { DocContent } from '@shared/types'
import { api } from '@/lib/api'
import { useStore } from '@/store/app'
import { changedCount, lineDiff } from '@/lib/diff'
import { cx } from '@/lib/util'
import { Button, Modal } from './ui'

type Status = 'loading' | 'saved' | 'dirty' | 'saving' | 'conflict'

/**
 * WYSIWYG editing on top of the Markdown file. The file is written only after a real
 * edit. If the editor would reformat lines the user didn't touch (tables, list markers…),
 * the first save shows a diff to confirm. Clean files autosave.
 */
export function DocEditor({ path, compact }: { path: string; compact?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const crepe = useRef<Crepe | null>(null)
  const doc = useRef<DocContent | null>(null)
  const baseline = useRef('')
  const acknowledged = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [status, setStatusState] = useState<Status>('loading')
  // Mirrors `status` so async callbacks and the cleanup see the current value, not the one they closed over.
  const statusRef = useRef<Status>('loading')
  const setStatus = useCallback((s: Status) => {
    statusRef.current = s
    setStatusState(s)
  }, [])
  const scrollTop = useRef(0)
  const loadedPath = useRef('')
  const scroller = useRef<HTMLDivElement>(null)
  const [review, setReview] = useState<{ next: string } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const vaultState = useStore((s) => s.state)
  const toast = useStore((s) => s.toast)

  const write = useCallback(
    async (next: string) => {
      if (!doc.current) return
      setStatus('saving')
      try {
        doc.current = await api.writeDoc(path, next, doc.current.hash)
        baseline.current = next
        // Keystrokes made while the write was in flight are not in the file yet: stay unsaved and save again.
        const now = crepe.current?.getMarkdown()
        if (now !== undefined && now !== next) {
          setStatus('dirty')
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => saveRef.current(), 800)
        } else setStatus('saved')
      } catch (e) {
        if (/changed on disk/.test((e as Error).message)) setStatus('conflict')
        else {
          toast((e as Error).message, 'error')
          setStatus('dirty')
        }
      }
    },
    [path, toast, setStatus]
  )

  const save = useCallback(() => {
    if (!crepe.current || !doc.current) return
    const next = crepe.current.getMarkdown()
    if (next === baseline.current) return setStatus('saved')
    const reformats = doc.current.content.trimEnd() !== baseline.current.trimEnd()
    if (reformats && !acknowledged.current) setReview({ next })
    else void write(next)
  }, [write, setStatus])
  const saveRef = useRef(save)
  saveRef.current = save

  // Create the editor for this file.
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    acknowledged.current = false
    // Same file reloading after an outside edit keeps its place; a different file starts at the top.
    if (loadedPath.current !== path) scrollTop.current = 0
    loadedPath.current = path
    api.readDoc(path).then(async (d) => {
      if (cancelled || !host.current) return
      doc.current = d
      host.current.innerHTML = ''
      const editor = new Crepe({
        root: host.current,
        defaultValue: d.content,
        features: { [Crepe.Feature.Latex]: false, [Crepe.Feature.AI]: false, [Crepe.Feature.TopBar]: false } as Record<string, boolean>
      })
      // Write Markdown the way the vault is written ("- " bullets, "*" emphasis), so saving doesn't rewrite every list.
      editor.editor.config((ctx) => ctx.update(remarkStringifyOptionsCtx, (o) => ({ ...o, bullet: '-' as const, bulletOther: '*' as const, emphasis: '*' as const, strong: '*' as const, rule: '-' as const, listItemIndent: 'one' as const })))
      await editor.create()
      if (cancelled) return void editor.destroy()
      crepe.current = editor
      baseline.current = editor.getMarkdown()
      editor.on((l) =>
        l.markdownUpdated((_ctx, md) => {
          if (md === baseline.current) return
          setStatus('dirty')
          if (timer.current) clearTimeout(timer.current)
          // Autosave only when saving can't reformat untouched lines.
          if (doc.current && doc.current.content.trimEnd() === baseline.current.trimEnd()) timer.current = setTimeout(save, 1200)
        })
      )
      setStatus('saved')
      if (scroller.current) scroller.current.scrollTop = scrollTop.current
    }, (e) => toast(e.message, 'error'))
    return () => {
      cancelled = true
      if (timer.current) clearTimeout(timer.current)
      // Leaving (another doc, another page) within the autosave delay must not drop the last edits.
      const ed = crepe.current
      const d = doc.current
      if (ed && d && statusRef.current === 'dirty' && d.content.trimEnd() === baseline.current.trimEnd()) {
        const md = ed.getMarkdown()
        if (md !== baseline.current) void api.writeDoc(path, md, d.hash).catch(() => {})
      }
      void ed?.destroy()
      crepe.current = null
    }
  }, [path, reloadKey, save, toast, setStatus])

  // External edits (Obsidian, Claude, Codex): reload if clean, flag if dirty.
  useEffect(() => {
    if (!doc.current || status === 'loading' || status === 'saving') return
    api.readDoc(path).then((d) => {
      if (!doc.current || d.hash === doc.current.hash) return
      if (status === 'saved') {
        scrollTop.current = scroller.current?.scrollTop ?? 0
        setReloadKey((k) => k + 1)
      }
      else setStatus('conflict')
    }, () => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultState])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 's') {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  const diff = review && doc.current ? lineDiff(doc.current.content.trimEnd(), review.next.trimEnd()) : []

  return (
    <div className={cx('flex flex-col min-h-0', compact ? '' : 'flex-1')}>
      <div className="flex items-center gap-2 px-5 @max-3xl:px-3 h-9 text-[11.5px] text-muted border-b border-line shrink-0">
        <span className="truncate flex-1 min-w-0" title={path}>{path}</span>
        {status === 'loading' && <Loader2 size={12} className="animate-spin" />}
        {status === 'saved' && <span className="whitespace-nowrap">Saved</span>}
        {status === 'saving' && <span className="whitespace-nowrap">Saving…</span>}
        {status === 'dirty' && (
          <>
            <span className="text-warn whitespace-nowrap">Unsaved</span>
            <Button kind="primary" onClick={save}>
              Save ⌘S
            </Button>
          </>
        )}
        {status === 'conflict' && (
          <>
            <span className="text-danger truncate min-w-0" title="Changed on disk by another app">Changed on disk by another app</span>
            <Button onClick={() => (setStatus('loading'), setReloadKey((k) => k + 1))} title="Reload (discard mine)">
              Reload
            </Button>
          </>
        )}
        <Button kind="ghost" onClick={() => api.revealVault(path)} label="Show in Finder">
          <FolderOpen size={13} />
        </Button>
      </div>
      <div ref={scroller} onScroll={(e) => (scrollTop.current = e.currentTarget.scrollTop)} className="doc-editor flex-1 min-h-0 overflow-y-auto px-8 @max-3xl:px-4">
        <div ref={host} />
      </div>
      {review && (
        <Modal onClose={() => setReview(null)} width="max-w-3xl">
          <div className="p-5 border-b border-line">
            <h2 className="text-[15px] font-semibold">Review changes before saving</h2>
            <p className="text-[12px] text-muted mt-0.5">
              The editor normalizes some Markdown (tables, list markers, spacing) in this file. {changedCount(diff)} lines will change. The previous
              version stays in git history.
            </p>
          </div>
          <pre className="max-h-[50vh] overflow-auto text-[11.5px] leading-relaxed p-4 font-mono">
            {diff.map((l, i) =>
              l.kind === 'same' ? null : (
                <div key={i} className={l.kind === 'add' ? 'text-ok bg-ok/10' : 'text-danger bg-danger/10'}>
                  {l.kind === 'add' ? '+ ' : '− '}
                  {l.text || ' '}
                </div>
              )
            )}
          </pre>
          <div className="p-4 border-t border-line flex justify-end gap-2">
            <Button kind="ghost" onClick={() => setReview(null)}>
              Keep editing
            </Button>
            <Button
              kind="primary"
              onClick={() => {
                acknowledged.current = true
                const next = review.next
                setReview(null)
                void write(next)
              }}
            >
              Save
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
