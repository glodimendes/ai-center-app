import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { TODOS_FILE } from '@shared/paths'
import { TEMPLATES, ensureFrameworkDirs } from './framework'

/** A brand-new vault's todo list: a few example tasks so the planner has something to show. */
const EXAMPLE_TODOS = `# Todos

## Work
- [ ] Try the planner: this task takes about two hours ~2h
- [ ] A task with a deadline due:2026-12-31 ~1h

## Personal
- [ ] Add your own tasks here ~30m
`

/** Creates a minimal vault the planner and agents can use. Never overwrites a file that already exists. */
export function createStarterVault(root: string): void {
  mkdirSync(root, { recursive: true })
  ensureFrameworkDirs(root)
  for (const [rel, text] of Object.entries({ ...TEMPLATES, [TODOS_FILE]: EXAMPLE_TODOS, '.gitignore': '.DS_Store\n' })) {
    const abs = join(root, rel)
    if (existsSync(abs)) continue
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, text)
  }
}
