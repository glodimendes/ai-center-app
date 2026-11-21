import type { AccountProfile } from '@shared/agents'

/** One profile per CLI, using each CLI's default login: exactly what the app did before profiles existed. */
export const DEFAULT_PROFILES: AccountProfile[] = [
  { id: 'claude', engine: 'claude', label: 'Claude' },
  { id: 'codex', engine: 'codex', label: 'Codex' }
]

export function findProfile(id: string, profiles: AccountProfile[] = DEFAULT_PROFILES): AccountProfile {
  const p = profiles.find((x) => x.id === id)
  if (!p) throw new Error(`No account profile "${id}".`)
  return p
}
