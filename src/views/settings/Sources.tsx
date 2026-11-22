import { useState } from 'react'
import { Eye, Plus, Trash2 } from 'lucide-react'
import type { SourceDef } from '@shared/agents'
import { PROJECTS_DIR } from '@shared/paths'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { cx } from '@/lib/util'
import { Button } from '@/components/ui'
import { input } from './AreaSettings'

const KIND_HELP: Record<SourceDef['kind'], string> = {
  'vault-path': `A file or folder inside the vault (e.g. ${PROJECTS_DIR}/notes.md).`,
  file: 'Any file or folder on this Mac (absolute path or ~/…).',
  url: 'A web page or text file (http/https), fetched when an agent runs.',
  gmail: 'Recent mail from your connected Gmail, matching a Gmail search. Agents can read it and propose drafts; nothing is ever sent.'
}

/** Settings → Data sources: places agents may read from. An agent lists their ids in its `sources`. */
export function SourcesSettings() {
  const agents = useStore((st) => st.state)!.agents
  const sources = agents.sources
  const gmail = agents.gmail
  const [preview, setPreview] = useState<{ id: string; text: string } | null>(null)
  const save = (list: SourceDef[]) => act(api.saveSources(list))
  const edit = (id: string, patch: Partial<SourceDef>) => save(sources.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const add = () => {
    let n = sources.length + 1
    while (sources.some((s) => s.id === `source-${n}`)) n++
    save([...sources, { id: `source-${n}`, kind: 'vault-path', label: `Source ${n}`, path: '' }])
  }
  const addGmail = () => save([...sources, { id: sources.some((x) => x.id === 'gmail-inbox') ? `gmail-${sources.length + 1}` : 'gmail-inbox', kind: 'gmail', label: 'Gmail inbox', query: 'newer_than:3d -category:promotions', max: 25 }])
  const show = async (id: string) => {
    try {
      setPreview({ id, text: await api.previewSource(id) })
    } catch (e) {
      setPreview({ id, text: (e as Error).message })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[12px] border border-line rounded-lg p-3">
        <span className="font-medium">Gmail</span>
        <span className={gmail.connected ? 'text-ok' : 'text-muted'}>{gmail.connected ? 'connected (read mail, create drafts; never sends)' : gmail.configured ? 'not connected' : 'needs your Google OAuth client (Settings → Calendar → Google), with the Gmail API enabled in that project'}</span>
        <div className="flex-1" />
        {gmail.connected ? (
          <Button kind="ghost" onClick={() => act(api.disconnectGmail(), 'Gmail disconnected')}>
            Disconnect
          </Button>
        ) : (
          <Button disabled={!gmail.configured} onClick={() => act(api.connectGmail(), 'Gmail connected')}>
            Connect Gmail
          </Button>
        )}
        <Button onClick={addGmail} title="Adds a source an agent can list, e.g. the Email triage sample uses gmail-inbox">
          <Plus size={13} /> Add Gmail source
        </Button>
      </div>
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
              <option value="gmail">Gmail</option>
            </select>
            <div className="flex-1" />
            <Button kind="ghost" title="Show what an agent would receive" onClick={() => show(s.id)}>
              <Eye size={13} /> Preview
            </Button>
            <Button kind="ghost" title="Delete this source" onClick={() => save(sources.filter((x) => x.id !== s.id))}>
              <Trash2 size={13} />
            </Button>
          </div>
          {s.kind === 'gmail' ? (
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-muted">Search</span>
              <input className={cx(input, 'flex-1 font-mono text-[11.5px]')} defaultValue={s.query ?? 'newer_than:3d'} onBlur={(e) => e.target.value.trim() !== (s.query ?? 'newer_than:3d') && edit(s.id, { query: e.target.value.trim() })} />
              <span className="text-muted">max</span>
              <input className={cx(input, 'w-16')} type="number" min={1} max={50} defaultValue={s.max ?? 25} onBlur={(e) => Number(e.target.value) !== (s.max ?? 25) && edit(s.id, { max: Number(e.target.value) })} />
            </div>
          ) : s.kind === 'url' ? (
            <input className={cx(input, 'w-full font-mono text-[11.5px]')} defaultValue={s.url ?? ''} placeholder="https://…" onBlur={(e) => e.target.value.trim() !== (s.url ?? '') && edit(s.id, { url: e.target.value.trim() })} />
          ) : (
            <input className={cx(input, 'w-full font-mono text-[11.5px]')} defaultValue={s.path ?? ''} placeholder={s.kind === 'vault-path' ? `${PROJECTS_DIR}/…` : '~/Documents/…'} onBlur={(e) => e.target.value.trim() !== (s.path ?? '') && edit(s.id, { path: e.target.value.trim() })} />
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
