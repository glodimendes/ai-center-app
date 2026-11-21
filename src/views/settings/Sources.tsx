import { useState } from 'react'
import { Eye, Plus, Trash2 } from 'lucide-react'
import type { SourceDef } from '@shared/agents'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { cx } from '@/lib/util'
import { Button } from '@/components/ui'
import { input } from './AreaSettings'

const KIND_HELP: Record<SourceDef['kind'], string> = {
  'vault-path': 'A file or folder inside the vault (e.g. 02_Projects/hybrid-training.md).',
  file: 'Any file or folder on this Mac (absolute path or ~/…).',
  url: 'A web page or text file (http/https), fetched when an agent runs.'
}

/** Settings → Data sources: places agents may read from. An agent lists their ids in its `sources`. */
export function SourcesSettings() {
  const sources = useStore((st) => st.state)!.agents.sources
  const [preview, setPreview] = useState<{ id: string; text: string } | null>(null)
  const save = (list: SourceDef[]) => act(api.saveSources(list))
  const edit = (id: string, patch: Partial<SourceDef>) => save(sources.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const add = () => {
    let n = sources.length + 1
    while (sources.some((s) => s.id === `source-${n}`)) n++
    save([...sources, { id: `source-${n}`, kind: 'vault-path', label: `Source ${n}`, path: '' }])
  }
  const show = async (id: string) => {
    try {
      setPreview({ id, text: await api.previewSource(id) })
    } catch (e) {
      setPreview({ id, text: (e as Error).message })
    }
  }

  return (
    <div className="space-y-3">
      {sources.length === 0 && <div className="text-[12px] text-faint">No sources yet. Add one, then put its id in an agent's “sources” list.</div>}
      {sources.map((s) => (
        <div key={s.id} className="border border-line rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <input className={cx(input, 'w-44')} defaultValue={s.label} onBlur={(e) => e.target.value !== s.label && edit(s.id, { label: e.target.value.trim() || s.label })} title="Name shown in the app" />
            <code className="text-[11.5px] text-muted" title="Use this id in an agent's sources list">
              {s.id}
            </code>
            <select className={input} value={s.kind} onChange={(e) => edit(s.id, { kind: e.target.value as SourceDef['kind'] })}>
              <option value="vault-path">vault path</option>
              <option value="file">file on this Mac</option>
              <option value="url">web address</option>
            </select>
            <div className="flex-1" />
            <Button kind="ghost" title="Show what an agent would receive" onClick={() => show(s.id)}>
              <Eye size={13} /> Preview
            </Button>
            <Button kind="ghost" title="Delete this source" onClick={() => save(sources.filter((x) => x.id !== s.id))}>
              <Trash2 size={13} />
            </Button>
          </div>
          {s.kind === 'url' ? (
            <input className={cx(input, 'w-full font-mono text-[11.5px]')} defaultValue={s.url ?? ''} placeholder="https://…" onBlur={(e) => e.target.value.trim() !== (s.url ?? '') && edit(s.id, { url: e.target.value.trim() })} />
          ) : (
            <input className={cx(input, 'w-full font-mono text-[11.5px]')} defaultValue={s.path ?? ''} placeholder={s.kind === 'vault-path' ? '02_Projects/…' : '~/Documents/…'} onBlur={(e) => e.target.value.trim() !== (s.path ?? '') && edit(s.id, { path: e.target.value.trim() })} />
          )}
          <div className="text-[11px] text-faint">{KIND_HELP[s.kind]}</div>
          {preview?.id === s.id && <pre className="text-[11px] bg-sunken rounded-md p-2 max-h-48 overflow-auto whitespace-pre-wrap">{preview.text}</pre>}
        </div>
      ))}
      <Button onClick={add}>
        <Plus size={13} /> Add a source
      </Button>
    </div>
  )
}
