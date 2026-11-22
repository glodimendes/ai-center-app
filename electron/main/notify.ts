import { app, BrowserWindow, Notification } from 'electron'
import { shouldNotify } from './agents/notice'

/** A system notification, only when the app isn't in front. Clicking it brings the window forward. */
export function notify(title: string, body: string, enabled: boolean | undefined, onClick: () => void) {
  if (!Notification.isSupported() || !shouldNotify(enabled, BrowserWindow.getAllWindows().some((w) => w.isFocused()))) return
  const n = new Notification({ title, body, silent: false })
  n.on('click', () => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed())
    if (w) (w.isMinimized() && w.restore(), w.show(), w.focus())
    onClick()
  })
  n.show()
}

/** The dock badge: how many things wait for you (macOS; a no-op elsewhere). */
export function setBadge(count: number) {
  app.setBadgeCount(count)
}
