import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { Settings } from '@shared/types'

const REAL_VAULT = join(homedir(), 'Documents/Personal Vault/AI Center')
const file = () => join(app.getPath('userData'), 'settings.json')

function defaults(): Settings {
  // Development runs against a scratch copy; the packaged app uses the real vault.
  const vaultPath = app.isPackaged ? REAL_VAULT : resolve(app.getAppPath(), '.dev-vault')
  return { vaultPath, autoCommit: true, contextEngine: 'codex', calendarProvider: 'macos', briefAuto: true, briefEmail: true, hiddenCalendars: [], eventAvailability: {} }
}

export function loadSettings(): Settings {
  const base = defaults()
  if (!existsSync(file())) return base
  try {
    return { ...base, ...JSON.parse(readFileSync(file(), 'utf8')) }
  } catch {
    return base
  }
}

export function saveSettings(s: Settings) {
  writeFileSync(file(), JSON.stringify(s, null, 2))
}
