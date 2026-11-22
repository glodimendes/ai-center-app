// Finds files for `@` references in a chat: walks the folders a conversation may use. No Electron imports.

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { FileHit } from '@shared/agents'

const SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'target', '__pycache__', 'venv'])
const MAX_PER_ROOT = 5000

export interface Entry {
  path: string
  rel: string
  root: string
}

/** Every file under `root` (dot folders and build output skipped), up to a cap so a huge folder can't stall the app. */
export function listFiles(root: string, cap = MAX_PER_ROOT): Entry[] {
  const out: Entry[] = []
  const walk = (dir: string, rel: string) => {
    let names: import('node:fs').Dirent[]
    try {
      names = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const d of names) {
      if (out.length >= cap) return
      if (d.name.startsWith('.')) continue
      const r = rel ? `${rel}/${d.name}` : d.name
      if (d.isDirectory()) {
        if (!SKIP.has(d.name)) walk(join(dir, d.name), r)
      } else if (d.isFile()) out.push({ path: join(dir, d.name), rel: r, root })
    }
  }
  walk(root, '')
  return out
}

/** Whether every letter of `q` appears in `s` in order. */
const subsequence = (s: string, q: string) => {
  let i = 0
  for (const c of s) if (c === q[i] && ++i === q.length) return true
  return q.length === 0
}

/** Best matches first: the name starts with the query, then name contains it, path contains it, then letters in order. Shorter paths win ties. */
export function rankFiles(entries: Entry[], query: string, limit = 20): FileHit[] {
  const q = query.trim().toLowerCase()
  const score = (e: Entry) => {
    const name = e.rel.slice(e.rel.lastIndexOf('/') + 1).toLowerCase()
    const rel = e.rel.toLowerCase()
    if (!q) return 4
    if (name.startsWith(q)) return 0
    if (name.includes(q)) return 1
    if (rel.includes(q)) return 2
    return subsequence(name, q) ? 3 : -1
  }
  return entries
    .map((e) => ({ e, s: score(e) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.e.rel.length - b.e.rel.length)
    .slice(0, limit)
    .map((x) => ({ path: x.e.path, rel: x.e.rel, root: x.e.root }))
}

const cache = new Map<string, { at: number; entries: Entry[] }>()

/** Files under the given roots matching `query`; each root's listing is kept for 30 s. */
export function findFiles(roots: string[], query: string): FileHit[] {
  const now = Date.now()
  const all = roots.flatMap((root) => {
    const hit = cache.get(root)
    if (hit && now - hit.at < 30_000) return hit.entries
    const entries = listFiles(root)
    cache.set(root, { at: now, entries })
    return entries
  })
  return rankFiles(all, query)
}
