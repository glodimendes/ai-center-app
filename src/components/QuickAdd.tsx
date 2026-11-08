import { useState } from 'react'
import { Plus } from 'lucide-react'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'

/**
 * Natural quick add: "Apply to UBS ~1h by 15/11 !high". The text is written to the
 * section as-is, so the vault keeps exactly what was typed.
 */
export function QuickAdd({ section, placeholder, autoFocus, onDone }: { section?: string[]; placeholder?: string; autoFocus?: boolean; onDone?: () => void }) {
  const sections = useStore((s) => s.state!.vault.sections)
  const [text, setText] = useState('')
  const [target, setTarget] = useState(section ? section.join('>') : (sections.find((s) => s.path.join('>') === 'ETH>Thesis') ?? sections[0])?.path.join('>') ?? '')

  const submit = async () => {
    if (!text.trim() || !target) return
    await act(api.addTask(target.split('>'), text.trim()))
    setText('')
    onDone?.()
  }

  return (
    <div className="flex items-center gap-2 py-1 pl-2 pr-2 rounded-md focus-within:bg-sunken/70">
      <Plus size={14} className="text-faint shrink-0" />
      <input
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') (setText(''), onDone?.())
        }}
        placeholder={placeholder ?? 'Add task: "Read paper ~1h by 15/11 !high"'}
        className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-faint"
      />
      {!section && (
        <select value={target} onChange={(e) => setTarget(e.target.value)} className="text-[11.5px] bg-transparent text-muted outline-none max-w-44">
          {sections.map((s) => (
            <option key={s.path.join('>')} value={s.path.join('>')}>
              {s.path.join(' › ')}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
