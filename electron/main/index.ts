import { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme } from 'electron'
import { join } from 'node:path'
import type { ApiMethod, AppState } from '@shared/api'
import { Controller } from './controller'

// App data stays in the folder from before the rename to "AI Center" (settings, plan cache, sync state).
// Dev builds share the productName with the installed app; keep their settings, caches and sync state apart.
app.setPath('userData', join(app.getPath('appData'), app.isPackaged ? 'AI Center Planner' : 'ai-center-planner-dev'))

let main: BrowserWindow | null = null
let capture: BrowserWindow | null = null
let controller: Controller

function load(win: BrowserWindow, hash = '') {
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'), { hash })
}

const webPreferences = () => ({
  preload: join(import.meta.dirname, '../preload/index.cjs'),
  contextIsolation: true,
  sandbox: false
})

function createMain() {
  main = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 640,
    minHeight: 480,
    title: 'AI Center',
    titleBarStyle: 'hiddenInset',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d12' : '#f7f7f8',
    webPreferences: webPreferences()
  })
  load(main)
  main.on('focus', () => void controller.refreshCalendar().catch(() => {}).finally(() => void controller.maybeRunBrief()))
  main.on('closed', () => (main = null))
}

function openCapture() {
  if (capture) return capture.focus()
  capture = new BrowserWindow({
    width: 560,
    height: 120,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    vibrancy: 'popover',
    transparent: true,
    webPreferences: webPreferences()
  })
  load(capture, 'capture')
  capture.on('blur', () => capture?.close())
  capture.on('closed', () => (capture = null))
}

app.whenReady().then(() => {
  const broadcast = (state: AppState) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('state', state))
  controller = new Controller(broadcast, (channel, payload) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, payload)))

  ipcMain.handle('api', async (_e, method: ApiMethod, ...args: unknown[]) => {
    const fn = controller[method] as (...a: unknown[]) => Promise<unknown>
    if (typeof fn !== 'function') throw new Error(`Unknown method ${method}`)
    return fn.apply(controller, args)
  })

  createMain()
  globalShortcut.register('CommandOrControl+Shift+Space', openCapture)
  void controller.refreshCalendar().catch(() => {}).finally(() => void controller.maybeRunBrief())

  app.on('activate', () => {
    if (!main) createMain()
  })
})

// Quitting when the last window closes keeps "nothing running when closed".
app.on('window-all-closed', () => app.quit())

app.on('will-quit', (e) => {
  globalShortcut.unregisterAll()
  if (controller) {
    e.preventDefault()
    void controller.dispose().finally(() => {
      controller = undefined as unknown as Controller
      app.exit(0)
    })
  }
})
