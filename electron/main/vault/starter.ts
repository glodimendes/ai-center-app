import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const FILES: Record<string, string> = {
  '00_START_HERE.md': `# Start here

This folder is your AI Center vault: plain Markdown files that you, the planner and your agents all read.

- \`05_Tasks/daily-todos.md\` — your tasks. Headings are areas; \`- [ ]\` lines are tasks. Add \`~2h\` for an estimate, \`due:2026-12-01\` for a deadline, \`!high\` for priority.
- \`05_Tasks/braindump-inbox.md\` — raw thoughts captured with ⌘⇧Space.
- \`06_Prompts/agents/\` — your agents, one Markdown file each (see the Agents view).
- Put notes about your projects and routines in any other folder; agents can read them.
`,
  '05_Tasks/daily-todos.md': `# Todos

## Work
- [ ] Try the planner: this task takes about two hours ~2h
- [ ] A task with a deadline due:2026-12-31 ~1h

## Personal
- [ ] Add your own tasks here ~30m
`,
  '05_Tasks/braindump-inbox.md': `# Braindump

`
}

/** Creates a minimal vault the planner and agents can use. Never overwrites a file that already exists. */
export function createStarterVault(root: string): void {
  mkdirSync(root, { recursive: true })
  for (const dir of ['02_Projects', '04_Context_Docs', '05_Tasks', '06_Prompts/agents']) mkdirSync(join(root, dir), { recursive: true })
  for (const [rel, text] of Object.entries(FILES)) {
    const abs = join(root, rel)
    if (existsSync(abs)) continue
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, text)
  }
}
