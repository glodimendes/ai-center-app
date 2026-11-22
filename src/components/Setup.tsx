import { useState } from 'react'
import { Check, FolderOpen, Sparkles, X } from 'lucide-react'
import { api } from '@/lib/api'
import { act, useStore } from '@/store/app'
import { cx } from '@/lib/util'
import { Button, Modal } from './ui'
import { SetupStatus } from './SetupPanel'

const INSTALL: Record<string, string> = {
  claude: 'Claude Code: npm install -g @anthropic-ai/claude-code, then run `claude` once to log in.',
  codex: 'Codex CLI: npm install -g @openai/codex, then run `codex` once to log in.',
  agy: 'Antigravity CLI (agy).',
  ollama: 'Ollama: install it and start it to use local models.'
}

/** First run: pick the vault (a chosen folder gets the framework files it lacks), see which AI CLIs were found, pick a calendar, add sample agents. Everything can be changed later in Settings; the Home checklist covers the rest. */
export function Setup() {
  const s = useStore((st) => st.state)!
  const [vaultChoice, setVaultChoice] = useState<string | null>(null)
  const vault = vaultChoice ?? s.vault.vaultPath
  const finish = (patch: Parameters<typeof api.saveSettings>[0] = {}) => act(api.saveSettings({ ...patch, setupDone: true }))

  const choose = async () => {
    const p = await api.chooseVault()
    if (p) {
      setVaultChoice(p)
      await act(api.saveSettings({ vaultPath: p }))
    }
  }

  const provider = s.settings.calendarProvider
  return (
    <Modal onClose={() => finish()} width="max-w-xl">
      <div className="p-6 space-y-5">
        <div className="flex items-start gap-3">
          <Sparkles size={20} className="text-accent mt-0.5" />
          <div className="flex-1">
            <h2 className="text-[16px] font-semibold">Welcome to AI Center</h2>
            <p className="text-[12.5px] text-muted mt-0.5">A planner and a place to define your own AI agents. Four quick choices; change any of them later in Settings. A checklist on Home walks you through the rest.</p>
          </div>
          <button onClick={() => finish()} className="text-faint hover:text-ink" title="Skip setup">
            <X size={16} />
          </button>
        </div>

        <section>
          <h3 className="text-[13px] font-semibold mb-1">1 · Your notes folder (the vault)</h3>
          <p className="text-[12px] text-muted mb-2">Tasks, notes and agents live as plain Markdown files. Use a folder you already have (an Obsidian vault works) or start with a small example one. A folder you choose gets the framework files it lacks (an entry point for AI tools, the rules they follow, a priorities and a todo file); nothing you wrote is changed.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11.5px] bg-sunken px-2 py-1.5 rounded-md truncate" title={vault}>
              {vault}
            </code>
            <Button onClick={choose}>
              <FolderOpen size={13} /> Choose folder
            </Button>
          </div>
          {!vaultChoice && vault.endsWith('/Vault') && <p className="text-[11px] text-faint mt-1">Currently the starter vault, created for you with a few example tasks.</p>}
          {vaultChoice && (
            <div className="mt-2">
              <SetupStatus compact />
            </div>
          )}
        </section>

        <section>
          <h3 className="text-[13px] font-semibold mb-1">2 · AI accounts</h3>
          <p className="text-[12px] text-muted mb-2">Agents run on command-line tools you already have and are logged in to; nothing is sent anywhere else.</p>
          <div className="space-y-1">
            {s.agents.cli.map((c) => (
              <div key={c.engine} className="flex items-start gap-2 text-[12px]">
                <span className={cx('mt-0.5', c.version ? 'text-ok' : 'text-faint')}>{c.version ? <Check size={13} /> : <X size={13} />}</span>
                <div>
                  <b>{c.engine}</b> {c.version ? <span className="text-muted">{c.version}</span> : <span className="text-muted">not found. {INSTALL[c.engine] ?? ''}</span>}
                </div>
              </div>
            ))}
            {!s.agents.cli.length && <div className="text-[12px] text-faint">Looking for tools…</div>}
          </div>
          <p className="text-[11px] text-faint mt-1">Add more accounts (a second Claude login, a local Ollama model) in Settings → Engines & accounts.</p>
        </section>

        <section>
          <h3 className="text-[13px] font-semibold mb-1">3 · Calendar</h3>
          <p className="text-[12px] text-muted mb-2">The planner reads your calendars to find free time and only ever changes events it created itself.</p>
          <div className="flex rounded-md border border-line overflow-hidden w-fit">
            {(
              [
                ['macos', 'macOS Calendar'],
                ['google', 'Google Calendar']
              ] as const
            ).map(([k, label]) => (
              <button key={k} onClick={() => act(api.saveSettings({ calendarProvider: k }))} className={cx('px-3 py-1.5 text-[12.5px]', provider === k ? 'bg-accent text-white' : 'bg-panel hover:bg-sunken')}>
                {label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-faint mt-1">You connect it (and grant access) from Settings → Calendar whenever you like.</p>
        </section>

        {s.agents.samples.length > 0 && (
          <section>
            <h3 className="text-[13px] font-semibold mb-1">4 · Sample agents (optional)</h3>
            <p className="text-[12px] text-muted mb-2">Ready-made agents saved as files in your vault; edit or delete them in Agents. They only answer or propose: anything with an effect waits for your click.</p>
            <div className="space-y-1.5">
              {s.agents.samples.map((x) => (
                <div key={x.id} className="flex items-start gap-2 text-[12px]">
                  <div className="flex-1 min-w-0">
                    <b>{x.name}</b> <span className="text-muted">{x.description}</span>
                    {x.needs && <span className="text-faint"> · needs {x.needs}</span>}
                  </div>
                  {x.added ? (
                    <span className="text-ok flex items-center gap-1 shrink-0">
                      <Check size={13} /> Added
                    </span>
                  ) : (
                    <Button onClick={() => act(api.addSampleAgent(x.id), `${x.name} added`)}>Add</Button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Pinned to the dialog's bottom edge: the steps scroll, the way out stays visible. */}
        <div className="sticky bottom-0 -mx-6 -mb-6 px-6 py-3 bg-panel border-t border-line flex justify-end">
          <Button kind="primary" onClick={() => finish()}>
            Get started
          </Button>
        </div>
      </div>
    </Modal>
  )
}
