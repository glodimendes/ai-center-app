/**
 * Undo an agent's edits to one file without touching anything written to it since.
 * The agent turned `before` into `after`; the file now reads `current`. Each changed stretch is
 * found in `current` by its surrounding lines and swapped back. Returns null when any stretch can't
 * be placed with certainty, so the caller leaves the file alone rather than guess.
 */
export function revertEdits(before: string, after: string, current: string): string | null {
  if (current === after) return before
  const b = before.split('\n')
  const a = after.split('\n')
  const c = current.split('\n')
  const hunks = diffHunks(a, b)
  const placed: { at: number; len: number; lines: string[] }[] = []
  for (const h of hunks) {
    const at = locate(a, c, h.start, h.end)
    if (at === null) return null
    placed.push({ at, len: h.end - h.start, lines: h.lines })
  }
  placed.sort((x, y) => x.at - y.at)
  for (let i = 1; i < placed.length; i++) if (placed[i].at < placed[i - 1].at + placed[i - 1].len) return null
  for (const p of placed.reverse()) c.splice(p.at, p.len, ...p.lines)
  return c.join('\n')
}

/** Stretches of `from` (start..end) to replace with `lines` to turn it into `to`. */
export function diffHunks(from: string[], to: string[]): { start: number; end: number; lines: string[] }[] {
  let pre = 0
  while (pre < from.length && pre < to.length && from[pre] === to[pre]) pre++
  let suf = 0
  while (suf < from.length - pre && suf < to.length - pre && from[from.length - 1 - suf] === to[to.length - 1 - suf]) suf++
  const f = from.slice(pre, from.length - suf)
  const t = to.slice(pre, to.length - suf)
  if (!f.length && !t.length) return []
  // Huge rewrites aren't worth a full LCS: one stretch is still exact.
  if (f.length * t.length > 4_000_000) return [{ start: pre, end: pre + f.length, lines: t }]
  const lcs = Array.from({ length: f.length + 1 }, () => new Uint32Array(t.length + 1))
  for (let i = f.length - 1; i >= 0; i--) for (let j = t.length - 1; j >= 0; j--) lcs[i][j] = f[i] === t[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: { start: number; end: number; lines: string[] }[] = []
  let i = 0
  let j = 0
  let open: { start: number; end: number; lines: string[] } | null = null
  const flush = () => open && (out.push(open), (open = null))
  while (i < f.length || j < t.length) {
    if (i < f.length && j < t.length && f[i] === t[j]) {
      flush()
      i++
      j++
    } else if (j < t.length && (i === f.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      open ??= { start: pre + i, end: pre + i, lines: [] }
      open.lines.push(t[j++])
    } else {
      open ??= { start: pre + i, end: pre + i, lines: [] }
      open.end = pre + ++i
    }
  }
  flush()
  return out
}

/**
 * Where from[start..end) sits in `cur`: the stretch plus 1–3 lines of context, first on both sides,
 * then on one side only (a neighbouring line may have changed since). Null unless exactly one match.
 */
function locate(from: string[], cur: string[], start: number, end: number): number | null {
  const tries: [number, number][] = []
  for (const side of ['both', 'before', 'after'] as const)
    for (let ctx = 1; ctx <= 3; ctx++) tries.push([side === 'after' ? 0 : ctx, side === 'before' ? 0 : ctx])
  for (const [cb, ca] of tries) {
    const s = Math.max(0, start - cb)
    const e = Math.min(from.length, end + ca)
    const needle = from.slice(s, e)
    if (!needle.length) continue
    // Anchored to a file edge, the match must be at that edge too.
    const atStart = cb > 0 && s === 0
    const atEnd = ca > 0 && e === from.length
    const hits: number[] = []
    for (let k = 0; k + needle.length <= cur.length; k++) {
      if (atStart && k !== 0) break
      if (atEnd && k + needle.length !== cur.length) continue
      if (needle.every((l, x) => cur[k + x] === l)) hits.push(k)
    }
    if (hits.length === 1) return hits[0] + (start - s)
  }
  return null
}
