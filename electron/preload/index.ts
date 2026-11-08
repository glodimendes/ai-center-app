import { contextBridge, ipcRenderer } from 'electron'
import type { Api, AppState } from '@shared/api'

const api = new Proxy({} as Api, {
  get: (_t, method: string) => async (...args: unknown[]) => {
    try {
      return await ipcRenderer.invoke('api', method, ...args)
    } catch (err) {
      // Strip Electron's "Error invoking remote method 'api': Error: " prefix.
      throw new Error(String((err as Error).message).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, ''))
    }
  }
})

contextBridge.exposeInMainWorld('api', {
  call: (method: keyof Api, ...args: unknown[]) => (api[method] as (...a: unknown[]) => Promise<unknown>)(...args),
  onState: (cb: (s: AppState) => void) => {
    const listener = (_e: unknown, s: AppState) => cb(s)
    ipcRenderer.on('state', listener)
    return () => ipcRenderer.removeListener('state', listener)
  },
  onBriefProgress: (cb: (line: string) => void) => {
    const listener = (_e: unknown, line: string) => cb(line)
    ipcRenderer.on('brief-progress', listener)
    return () => ipcRenderer.removeListener('brief-progress', listener)
  },
  onProgress: (cb: (line: string) => void) => {
    const listener = (_e: unknown, line: string) => cb(line)
    ipcRenderer.on('context-progress', listener)
    return () => ipcRenderer.removeListener('context-progress', listener)
  }
})
