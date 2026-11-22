// Files attached to a chat message: what the model is told, and which folders it must be allowed to read. No Electron imports.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative } from 'node:path'

const TEXT_EXT = /\.(md|markdown|txt|csv|tsv|json|ya?ml|toml|ini|log|xml|html?|css|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|sh|sql|tex|bib|r)$/i
/** Most characters of attached text handed to an engine that can't open files itself. */
export const INLINE_CAP = 20_000

const inside = (root: string, p: string) => {
  const rel = relative(root, p)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * The text added to a turn for its attachments. Engines that can read files (Claude, Codex, Antigravity) get the paths;
 * the others (Ollama, a custom command) get the text of text files inline, up to a cap, and a note for anything else.
 */
export function attachmentBlock(files: string[], canReadFiles: boolean): string {
  if (!files.length) return ''
  if (canReadFiles) return `Files the user attached (read them as needed):\n${files.map((f) => `- ${f}`).join('\n')}`
  let left = INLINE_CAP
  const parts = files.map((f) => {
    if (!TEXT_EXT.test(f) || !existsSync(f)) return `[${basename(f)}: not readable by this engine]`
    try {
      if (statSync(f).size > 5_000_000) return `[${basename(f)}: too large to include]`
      const text = readFileSync(f, 'utf8').slice(0, Math.max(0, left))
      left -= text.length
      return `File ${basename(f)}:\n"""\n${text}\n"""`
    } catch {
      return `[${basename(f)}: not readable]`
    }
  })
  return `Files the user attached:\n${parts.join('\n\n')}`
}

/** Folders of attached files that no folder the run already has covers: they must be added so the CLI may read them. */
export function attachDirs(files: string[], known: string[]): string[] {
  const out: string[] = []
  for (const f of files) {
    const d = dirname(f)
    if (!known.some((k) => inside(k, d)) && !out.some((k) => inside(k, d))) out.push(d)
  }
  return out
}
