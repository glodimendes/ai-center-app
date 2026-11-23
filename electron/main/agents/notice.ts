// What an agent notification says and when it may show. No Electron imports.

export type NoticeKind = 'failed' | 'paused' | 'approval' | 'review' | 'goal' | 'routine'

/** Only while the app isn't in front (you would see it anyway) and the setting is on (default on). */
export const shouldNotify = (enabled: boolean | undefined, appFocused: boolean) => enabled !== false && !appFocused

/** A short title and line. Never the answer text: a notification can show on a locked screen. */
export function notice(kind: NoticeKind, name: string, detail = ''): { title: string; body: string } {
  const one = detail.replace(/\s+/g, ' ').trim().slice(0, 120)
  if (kind === 'failed') return { title: `${name} failed`, body: one || 'The run stopped with an error.' }
  if (kind === 'paused') return { title: `${name} is waiting`, body: one || 'The account is near its usage limit. Allow it or skip it.' }
  if (kind === 'approval') return { title: `${name} wants your OK`, body: one || 'An action is waiting for approval.' }
  if (kind === 'routine') return { title: `${name} answered`, body: one ? `${one}: the answer is in its chat.` : 'The answer is in its chat.' }
  if (kind === 'review') return { title: `${name} changed files`, body: one || 'Keep or undo the changes.' }
  return { title: 'Goal update', body: one ? `${name}: ${one}` : name }
}
