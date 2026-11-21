import { useState } from 'react'
import { Inbox } from 'lucide-react'
import { api } from '@/lib/api'

/** Frameless quick-capture window (⌘⇧Space): Enter saves to the inbox, Esc closes. */
export function Capture() {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  return (
    <div className="h-full p-3">
      <div className="h-full rounded-2xl bg-panel/95 border border-line shadow-2xl flex items-center gap-3 px-4">
        <Inbox size={18} className="text-accent shrink-0" />
        <input
          autoFocus
          value={text}
          onChange={(e) => (setText(e.target.value), setError(''))}
          onKeyDown={async (e) => {
            if (e.key === 'Escape') void api.closeCapture()
            if (e.key === 'Enter' && text.trim()) {
              try {
                const r = await api.capture(text.trim())
                setSaved(r.kind === 'agent' ? `Sent to ${r.agent}` : 'Saved')
                setTimeout(() => api.closeCapture(), r.kind === 'agent' ? 900 : 350)
              } catch (err) {
                setError((err as Error).message)
              }
            }
          }}
          placeholder="Capture to inbox, or @agent message…"
          className="flex-1 bg-transparent outline-none text-[17px] placeholder:text-faint"
        />
        {saved && <span className="text-ok text-[12px]">{saved}</span>}
        {error && <span className="text-danger text-[11.5px] max-w-[45%] truncate" title={error}>{error}</span>}
      </div>
    </div>
  )
}
