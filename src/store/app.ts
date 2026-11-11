import { create } from 'zustand'
import type { AppState } from '@shared/api'
import { api } from '@/lib/api'

export type View = 'brief' | 'today' | 'week' | 'tasks' | 'alerts' | 'inbox' | 'docs' | 'review' | 'settings'

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
  toasts: Toast[]
  setState: (s: AppState) => void
  go: (v: View) => void
  setDay: (d: string) => void
  selectBlock: (id: string | null) => void
  openDoc: (path: string) => void
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
  toasts: [],
  setState: (state) => set({ state }),
  go: (view) => set({ view }),
  setDay: (day) => set({ day, selectedBlockId: null }),
  selectBlock: (selectedBlockId) => set({ selectedBlockId }),
  openDoc: (docPath) => set({ docPath, view: 'docs' }),
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
