import type { CategoryPref } from './types'

/**
 * Category of a todo section: walk from the deepest heading up. A heading picked exactly
 * (case-insensitive) wins; older free-text entries still match as substrings.
 */
export function resolveCategory(section: string[], categories: CategoryPref[]): string {
  for (let i = section.length - 1; i >= 0; i--) {
    const h = section[i].toLowerCase().trim()
    const exact = categories.find((c) => c.headings.some((n) => n.toLowerCase().trim() === h))
    if (exact) return exact.key
    const loose = categories.find((c) => c.headings.some((n) => n && h.includes(n.toLowerCase())))
    if (loose) return loose.key
  }
  return 'other'
}

/** The category a heading is directly assigned to (not inherited), or null. */
export function directCategory(heading: string, categories: CategoryPref[]): string | null {
  const h = heading.toLowerCase().trim()
  return (
    categories.find((c) => c.headings.some((n) => n.toLowerCase().trim() === h))?.key ??
    categories.find((c) => c.headings.some((n) => n && h.includes(n.toLowerCase())))?.key ??
    null
  )
}
