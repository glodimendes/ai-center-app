// An agent's own notes between runs: one Markdown file per agent in the app's data folder. No Electron imports.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The file is trimmed to this many characters (oldest lines go first); the prompt carries at most PROMPT_CHARS of it. */
export const MEMORY_CHARS = 8000
export const PROMPT_CHARS = 4000

const file = (dir: string, id: string) => join(dir, `${id}.md`)

export function readMemory(dir: string, id: string): string {
  try {
    return existsSync(file(dir, id)) ? readFileSync(file(dir, id), 'utf8') : ''
  } catch {
    return ''
  }
}

/** Keeps the newest lines that fit in `max` characters. */
export function trimNotes(text: string, max: number): string {
  if (text.length <= max) return text
  const lines = text.split('\n')
  let kept = ''
  for (let i = lines.length - 1; i >= 0; i--) {
    const next = kept ? `${lines[i]}\n${kept}` : lines[i]
    if (next.length > max) break
    kept = next
  }
  return kept
}

export function writeMemory(dir: string, id: string, text: string) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(file(dir, id), trimNotes(text.trim(), MEMORY_CHARS) + '\n')
}

/** One note as it is stored: a single line, at most 500 characters. */
const oneLine = (note: string) => note.replace(/\s+/g, ' ').trim().slice(0, 500)

/** Adds one dated line (what the agent asked to remember). */
export function appendMemory(dir: string, id: string, note: string, date: string) {
  const line = oneLine(note)
  if (!line) throw new Error('The note is empty.')
  writeMemory(dir, id, `${readMemory(dir, id).trim()}\n- ${date}: ${line}`.trim())
}

/** Takes the newest line holding this note out again (Undo under a message). Does nothing if the user already edited it away. */
export function removeNote(dir: string, id: string, note: string) {
  const line = oneLine(note)
  const lines = readMemory(dir, id).split('\n')
  let at = lines.length - 1
  while (at >= 0 && !lines[at].endsWith(`: ${line}`)) at--
  if (!line || at < 0) return
  lines.splice(at, 1)
  writeMemory(dir, id, lines.join('\n'))
}

export function removeMemory(dir: string, id: string) {
  rmSync(file(dir, id), { force: true })
}

/** The part of the notes a prompt carries (the newest). */
export const notesForPrompt = (text: string) => trimNotes(text.trim(), PROMPT_CHARS)
