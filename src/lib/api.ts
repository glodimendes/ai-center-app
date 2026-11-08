import type { Api, AppState } from '@shared/api'

declare global {
  interface Window {
    api: {
      call: (method: keyof Api, ...args: unknown[]) => Promise<unknown>
      onState: (cb: (s: AppState) => void) => () => void
      onProgress: (cb: (line: string) => void) => () => void
      onBriefProgress: (cb: (line: string) => void) => () => void
    }
  }
}

/** Typed client for the main-process API. */
export const api = new Proxy({} as Api, {
  get: (_t, method: string) => (...args: unknown[]) => window.api.call(method as keyof Api, ...args)
})
