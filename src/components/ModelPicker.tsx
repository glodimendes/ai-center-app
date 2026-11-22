import { useEffect, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { AgentDef, ChatModelOption, ChatOverride } from '@shared/agents'
import { api } from '@/lib/api'
import { act } from '@/store/app'
import { cx } from '@/lib/util'
import { Popover } from './ui'

const short = (m?: string) => (m ? m.replace(/^claude-/, '') : 'default model')

/** The account, model and effort a conversation runs with: starts as the agent's own, a pick here lasts for this conversation. */
export function ModelPicker({ agent, override }: { agent: AgentDef; override?: ChatOverride }) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<ChatModelOption[] | null>(null)
  useEffect(() => {
    if (open && !options) api.chatModels().then(setOptions, () => setOptions([]))
  }, [open])
  const now: ChatOverride = override ?? { profile: agent.profile, model: agent.model, effort: agent.effort }
  const acct = options?.find((o) => o.profile === now.profile)
  const set = (o: ChatOverride) => act(api.chatSetModel(agent.id, o))
  return (
    <span className="relative inline-block shrink-0">
      <button onClick={() => setOpen((o) => !o)} title="Model and effort for this conversation" className={cx('h-8 px-2.5 rounded-full text-[12px] flex items-center gap-1 hover:bg-sunken', override ? 'text-accent' : 'text-muted')}>
        <span className="truncate max-w-[11rem]">{short(now.model)}{now.effort ? ` · ${now.effort}` : ''}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} align="right" className="w-72">
          <button
            onClick={() => (act(api.chatSetModel(agent.id, null)), setOpen(false))}
            className="w-full text-left px-2.5 py-1.5 rounded-md text-[13px] hover:bg-sunken flex items-center gap-2"
          >
            <span className="flex-1">Use the agent's own</span>
            {!override && <Check size={13} className="text-accent" />}
          </button>
          {!options && <div className="px-2.5 py-1.5 text-[12.5px] text-muted">Loading…</div>}
          {options?.map((o) => (
            <div key={o.profile} className="mt-1 border-t border-line/70 pt-1">
              <div className="px-2.5 py-1 text-[11.5px] text-faint">{o.label}</div>
              {o.models.length === 0 && (
                <button onClick={() => set({ profile: o.profile })} className="w-full text-left px-2.5 py-1.5 rounded-md text-[13px] hover:bg-sunken flex items-center gap-2">
                  <span className="flex-1 text-muted">Chosen by the account</span>
                  {now.profile === o.profile && <Check size={13} className="text-accent" />}
                </button>
              )}
              {o.models.map((m) => (
                <button
                  key={m}
                  onClick={() => set({ profile: o.profile, model: m, effort: now.profile === o.profile ? now.effort : undefined })}
                  className="w-full text-left px-2.5 py-1.5 rounded-md text-[13px] hover:bg-sunken flex items-center gap-2"
                >
                  <span className="flex-1 truncate">{m}</span>
                  {now.profile === o.profile && now.model === m && <Check size={13} className="text-accent" />}
                </button>
              ))}
            </div>
          ))}
          {acct && acct.efforts.length > 0 && (
            <div className="mt-1 border-t border-line/70 pt-1.5 px-1.5">
              <div className="px-1 pb-1 text-[11.5px] text-faint">Effort</div>
              <div className="flex flex-wrap gap-1">
                {acct.efforts.map((e) => (
                  <button
                    key={e}
                    onClick={() => set({ ...now, effort: now.effort === e ? undefined : e })}
                    className={cx('px-2 h-6 rounded-full text-[12px] border', now.effort === e ? 'bg-accent text-white border-accent' : 'border-line text-muted hover:text-ink')}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Popover>
      )}
    </span>
  )
}
