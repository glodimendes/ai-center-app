import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Sparkles } from 'lucide-react'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { Button } from '@/components/ui'

const textarea = 'w-full px-2 py-1.5 rounded-md border border-line bg-bg text-[12px] font-mono leading-relaxed outline-none focus:border-accent resize-y'

/** Editor for the daily brief instructions (06_Prompts/daily-brief.md). The output format stays fixed. */
export function BriefPromptEditor() {
  const running = useStore((st) => st.state!.brief.running)
  const [saved, setSaved] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [defaultText, setDefaultText] = useState('')
  const [format, setFormat] = useState('')
  const [showFormat, setShowFormat] = useState(false)

  const load = async () => {
    const p = await act(api.getBriefPrompt())
    if (!p) return
    // The vault file gains a trailing newline on save; treat a saved copy of the default as the default.
    const current = p.custom && p.custom.trim() !== p.defaultText.trim() ? p.custom : p.defaultText
    setSaved(current)
    setText(current)
    setDefaultText(p.defaultText)
    setFormat(p.format)
  }
  useEffect(() => {
    void load()
  }, [])

  const dirty = saved !== null && text !== saved

  return (
    <div className="mt-4 pt-4 border-t border-line">
      <div className="text-[12.5px] font-medium mb-1">Prompt</div>
      <p className="text-[11.5px] text-muted mb-2">
        Saved in your vault as 06_Prompts/daily-brief.md. Placeholders: <code>{'{{date}}'}</code> today's date, <code>{'{{calendar}}'}</code> today's events,{' '}
        <code>{'{{email}}'}</code> the email instruction (depends on “Include email”). Anything you leave out is added at the end, so the calendar is never dropped.
      </p>
      <textarea className={textarea} rows={14} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} disabled={saved === null} />
      <button onClick={() => setShowFormat(!showFormat)} className="flex items-center gap-1 mt-2 text-[11.5px] text-muted">
        {showFormat ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Output format (fixed, the app needs it)
      </button>
      {showFormat && <pre className="mt-1 px-2 py-1.5 rounded-md bg-sunken text-[11.5px] font-mono whitespace-pre-wrap text-muted">{format}</pre>}
      <div className="flex items-center gap-2 mt-3">
        <Button
          kind="primary"
          disabled={!dirty}
          onClick={async () => {
            const ok = await act(api.saveBriefPrompt(text).then(() => true), 'Brief prompt saved')
            if (ok) setSaved(text)
          }}
        >
          Save prompt
        </Button>
        <Button
          disabled={saved === null || (text === defaultText && saved === defaultText)}
          onClick={async () => {
            const ok = await act(api.saveBriefPrompt(null).then(() => true), 'Brief prompt reset to default')
            if (ok) await load()
          }}
        >
          Reset to default
        </Button>
        <span className="flex-1" />
        <Button disabled={running} onClick={() => act(api.generateBrief())} title="Uses the saved prompt">
          {running ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Run daily brief now
        </Button>
      </div>
    </div>
  )
}
