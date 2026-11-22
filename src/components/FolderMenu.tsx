import { useState } from 'react'
import { FileText, Folder, FolderPlus, Lock, X } from 'lucide-react'
import type { AgentDef } from '@shared/agents'
import { api } from '@/lib/api'
import { act } from '@/store/app'
import { cx } from '@/lib/util'
import { Popover } from './ui'

const tail = (p: string) => p.split('/').filter(Boolean).pop() ?? p
/** A path as the user would say it: `~` for the home folder. */
const tidy = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

/**
 * The folders of one conversation: where the agent works and saves, the other folders it may use, and the vault.
 * Changes here apply to this conversation only; "Save as default" writes them into the agent.
 */
export function FolderMenu({ agent, convo, folder, extra, vault }: { agent: AgentDef; convo: string; folder?: string; extra: string[]; vault: string }) {
  const [open, setOpen] = useState(false)
  const own = agent.workdir ? (agent.workdir.startsWith('/') ? agent.workdir : `${vault}/${agent.workdir}`) : undefined
  const main = folder ?? own
  const changed = Boolean(folder) || extra.length > 0
  const choose = async () => {
    const f = await api.chooseFolder()
    return f ?? undefined
  }
  const row = 'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px]'
  return (
    <span className="no-drag relative inline-block max-w-[16rem]">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Folders this conversation works in"
        className={cx('flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[12px] hover:text-ink max-w-full', changed ? 'text-accent' : 'text-muted')}
      >
        <Folder size={13} className="shrink-0" />
        <span className="truncate">{main ? tail(main) : 'Own workspace'}</span>
        {(agent.folders?.length ?? 0) + extra.length > 0 && <span className="shrink-0 text-faint">+{(agent.folders?.length ?? 0) + extra.length}</span>}
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} align="right" className="w-80">
          <div className="px-2.5 pt-1 pb-0.5 text-[11.5px] text-faint">Works in · saves its files here</div>
          <div className={row}>
            <Folder size={14} className="shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{main ? tail(main) : 'Own workspace'}</div>
              <div className="truncate text-[11.5px] text-faint">{main ? tidy(main) : "A private folder just for this agent"}</div>
            </div>
            <button onClick={async () => { const f = await choose(); if (f) act(api.chatSetFolder(convo, f)) }} className="shrink-0 text-[12px] text-accent hover:underline">
              Change…
            </button>
            {folder && (
              <button onClick={() => act(api.chatSetFolder(convo, null))} title="Back to the agent's own folder" className="shrink-0 text-faint hover:text-danger">
                <X size={13} />
              </button>
            )}
          </div>

          <div className="mt-1 border-t border-line/70 px-2.5 pt-1.5 pb-0.5 text-[11.5px] text-faint">Also available</div>
          {(agent.folders ?? []).map((f) => (
            <div key={f} className={row} title="Set in the agent's settings">
              <FileText size={14} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate">{tidy(f.startsWith('/') ? f : `${vault}/${f}`)}</span>
              <span className="text-[11px] text-faint">agent</span>
            </div>
          ))}
          {extra.filter((f) => !(agent.folders ?? []).includes(f)).map((f) => (
            <div key={f} className={row}>
              <Folder size={14} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate" title={f}>{tidy(f)}</span>
              <button onClick={() => act(api.chatSetExtraFolders(convo, extra.filter((x) => x !== f)))} title="Remove from this conversation" className="shrink-0 text-faint hover:text-danger">
                <X size={13} />
              </button>
            </div>
          ))}
          <div className={cx(row, 'text-muted')}>
            <Lock size={13} className="shrink-0 text-faint" />
            <span className="min-w-0 flex-1 truncate">AI Center vault</span>
            <span className="text-[11px] text-faint">always</span>
          </div>
          <button
            onClick={async () => { const f = await choose(); if (f && !extra.includes(f) && !(agent.folders ?? []).includes(f)) act(api.chatSetExtraFolders(convo, [...extra, f])) }}
            className={cx(row, 'w-full text-accent hover:bg-sunken')}
          >
            <FolderPlus size={14} /> Add a folder…
          </button>

          {changed && (
            <div className="mt-1 border-t border-line/70 pt-1.5 px-1 flex items-center justify-between gap-2 text-[12px]">
              <button
                onClick={() => act(Promise.all([api.chatSetFolder(convo, null), api.chatSetExtraFolders(convo, [])]), 'Back to the agent\'s own folders')}
                className="text-muted hover:text-ink"
              >
                Reset
              </button>
              <button
                onClick={() =>
                  act(
                    api
                      .saveAgent({ ...agent, workdir: folder ?? agent.workdir, folders: [...new Set([...(agent.folders ?? []), ...extra])] })
                      .then(() => Promise.all([api.chatSetFolder(convo, null), api.chatSetExtraFolders(convo, [])])),
                    `Saved as ${agent.name}'s default folders`
                  )
                }
                className="text-accent hover:underline"
              >
                Save as {agent.name}'s default
              </button>
            </div>
          )}
        </Popover>
      )}
    </span>
  )
}
