import { create } from 'zustand'
import type { AppState } from '@shared/api'
import { api } from '@/lib/api'

export type View = 'brief' | 'today' | 'week' | 'tasks' | 'alerts' | 'inbox' | 'docs' | 'review' | 'chat' | 'agents' | 'settings'

interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
  action?: { label: string; run: () => void }
}

interface Store {
  state: AppState | null
  view: View
  /** Day shown in Today (yyyy-mm-dd). */
  day: string
  selectedBlockId: string | null
  docPath: string | null
  /** Conversation open in Chat: `central` or an agent id. */
  chatTarget: string
  toasts: Toast[]
  /** Unsent text per conversation (`_central` or an agent id), so switching chats loses nothing. */
  drafts: Record<string, string>
  /** Per target conversation: where the text in its draft was handed over from. */
  origins: Record<string, string>
  setDraft: (key: string, text: string) => void
  /** Files attached to the unsent message, per conversation. */
  draftFiles: Record<string, string[]>
  setDraftFiles: (key: string, files: string[]) => void
  /** Opens `agentId`'s chat with `text` quoted in its draft, remembering `origin`. */
  handOff: (target: string, text: string, origin: string) => void
  setState: (s: AppState) => void
  go: (v: View) => void
  setDay: (d: string) => void
  selectBlock: (id: string | null) => void
  openDoc: (path: string) => void
  openChat: (target: string) => void
  toast: (text: string, kind?: Toast['kind'], action?: Toast['action']) => void
  dismiss: (id: number) => void
}

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const useStore = create<Store>((set, get) => ({
  state: null,
  view: 'brief',
  day: todayISO(),
  selectedBlockId: null,
  docPath: null,
  chatTarget: 'central',
  toasts: [],
  drafts: {},
  origins: {},
  setDraft: (key, text) => set({ drafts: { ...get().drafts, [key]: text } }),
  draftFiles: {},
  setDraftFiles: (key, files) => set({ draftFiles: { ...get().draftFiles, [key]: files } }),
  handOff: (target, text, origin) => {
    const quoted = text.trim().split('\n').map((l) => `> ${l}`).join('\n')
    const { drafts, origins } = get()
    // The central conversation is `central` as a target and `_central` as a key.
    const key = target === 'central' ? '_central' : target
    set({ drafts: { ...drafts, [key]: `${drafts[key] ? `${drafts[key]}\n\n` : ''}${quoted}\n\n` }, origins: { ...origins, [key]: origin }, chatTarget: key === '_central' ? 'central' : key, view: 'chat' })
  },
  setState: (state) => set({ state }),
  go: (view) => set({ view }),
  setDay: (day) => set({ day, selectedBlockId: null }),
  selectBlock: (selectedBlockId) => set({ selectedBlockId }),
  openDoc: (docPath) => set({ docPath, view: 'docs' }),
  openChat: (chatTarget) => set({ chatTarget, view: 'chat' }),
  toast: (text, kind = 'info', action) => {
    const id = Date.now() + Math.random()
    set({ toasts: [...get().toasts, { id, text, kind, action }] })
    setTimeout(() => get().dismiss(id), kind === 'error' || action ? 7000 : 3500)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))

/** Run an API call, surfacing failures as a toast. */
export async function act<T>(p: Promise<T>, ok?: string): Promise<T | undefined> {
  try {
    const out = await p
    if (ok) useStore.getState().toast(ok)
    return out
  } catch (err) {
    useStore.getState().toast((err as Error).message, 'error')
    return undefined
  }
}

export async function bootstrap() {
  // A failed call nobody awaited with act() still tells the user instead of vanishing.
  window.addEventListener('unhandledrejection', (e) => {
    const msg = (e.reason as Error)?.message ?? String(e.reason)
    useStore.getState().toast(msg, 'error')
  })
  const s = await api.getState()
  useStore.getState().setState(s)
  window.api.onState((next) => useStore.getState().setState(next))
}
