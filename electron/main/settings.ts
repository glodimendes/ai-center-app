import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Settings } from '@shared/types'

const file = () => join(app.getPath('userData'), 'settings.json')

function defaults(): Settings {
  // Development runs against a scratch copy; the packaged app starts with a starter vault in its own data folder,
  // which the first-run setup can swap for the user's own folder.
  const vaultPath = app.isPackaged ? join(app.getPath('userData'), 'Vault') : resolve(app.getAppPath(), '.dev-vault')
  return { vaultPath, setupDone: !app.isPackaged, autoCommit: true, contextEngine: 'codex', askEngine: 'claude', calendarProvider: 'macos', briefAuto: true, briefEmail: true, hiddenCalendars: [], eventAvailability: {} }
}

export function loadSettings(): Settings {
  const base = defaults()
  if (!existsSync(file())) return base
  try {
    // A settings file from before the setup existed means the user is already set up.
    const stored = { ...base, setupDone: true, ...JSON.parse(readFileSync(file(), 'utf8')) }
    // Development never opens the real vault, whatever a settings file says.
    return app.isPackaged ? stored : { ...stored, vaultPath: base.vaultPath }
  } catch {
    return base
  }
}

export function saveSettings(s: Settings) {
  writeFileSync(file(), JSON.stringify(s, null, 2))
}
