import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SetupCheck } from '@shared/types'
import {
  ABOUT_ME_FILE, AGENTS_DIR, APP_OWNED_DIRS, CLAUDE_FILE, CONTEXT_DIR, INBOX_FILE, MAINTENANCE_FILE, PRIORITIES_FILE, PROJECTS_DIR,
  PROMPTS_DIR, RULES_FILE, START_FILE, TASKS_DIR, TODOS_FILE, WORKFLOWS_DIR
} from '@shared/paths'

// The framework every vault works on: the entry point, the rules every AI follows, the context files the
// app reads and the task files the planner reads. New vaults get all of it; a folder the user picks gets
// what it lacks. Nothing here ever overwrites an existing file. (Updating shipped templates in existing
// vaults is part of the "evolve" idea in the ROADMAP, not built.)

const name = (p: string) => p.slice(p.lastIndexOf('/') + 1)

/** Folders the framework expects (created when missing; git ignores them while empty). */
export const FRAMEWORK_DIRS = [PROJECTS_DIR, WORKFLOWS_DIR, CONTEXT_DIR, TASKS_DIR, AGENTS_DIR]

/** The shipped templates, added to a vault that lacks them. */
export const TEMPLATES: Record<string, string> = {
  [START_FILE]: `# AI Center vault

This folder is your AI Center vault: plain Markdown files that you, the planner and your agents all read. AI tools start here.

## Start
1. Read only what the task needs (see the table).
2. Before editing anything, read \`${RULES_FILE}\`. When something changed or should be remembered, follow \`${MAINTENANCE_FILE}\`.

## What to load
| Task | Read |
|---|---|
| Almost anything personal | \`${ABOUT_ME_FILE}\` |
| Planning the day or week | \`${PRIORITIES_FILE}\`, \`${TODOS_FILE}\` |
| A project | the matching file in \`${PROJECTS_DIR}/\` |

## Folders
- \`${PROJECTS_DIR}/\`: one note per project.
- \`${WORKFLOWS_DIR}/\`: the editing rules.
- \`${CONTEXT_DIR}/\`: about you and your current priorities.
- \`${TASKS_DIR}/\`: \`${name(TODOS_FILE)}\` (your tasks: headings are areas, \`- [ ]\` lines are tasks, \`~2h\` an estimate, \`due:2026-12-01\` a deadline, \`!high\` a priority) and \`${name(INBOX_FILE)}\` (captures from ⌘⇧Space). The app writes the subfolders itself.
- \`${PROMPTS_DIR}/\`: the daily brief's instructions and \`${name(AGENTS_DIR)}/\` (one file per agent, see the Agents view).
`,
  [CLAUDE_FILE]: `@${START_FILE}

This vault's entry point and rules are in \`${START_FILE}\`; Claude Code loads it through the import above.
`,
  [RULES_FILE]: `# File Update Rules

Rules for every assistant and agent that edits this vault. The user's current request wins over them.

## Never edit (written by the app)
${APP_OWNED_DIRS.map((d) => `- \`${d}/\``).join('\n')}

## Never move or rename (read by path)
Top-level folders, \`${START_FILE}\`, \`${CLAUDE_FILE}\`, this file, \`${MAINTENANCE_FILE}\`, \`${PRIORITIES_FILE}\`, \`${TODOS_FILE}\`, \`${INBOX_FILE}\`.

## Editing \`${TODOS_FILE}\`
Change single lines only: add a task, check one off, or edit one task line. Never reorder or rewrite the file. Use absolute dates and keep the task's language.

## Ask first
Deleting, moving or merging files; rewriting more than one section; sensitive facts; anything you would be guessing.

## Never store
Passwords, keys, tokens or account numbers.

## Finish
List each file you changed with one line on what changed.
`,
  [MAINTENANCE_FILE]: `# Context Maintenance

Use when something changed or should be remembered. Follow \`${name(RULES_FILE)}\`.

1. Find where the fact already lives and update it there; otherwise pick the narrowest file below.
2. Change only the affected lines and update \`Last updated:\`.
3. If what matters most changed, update \`## Active Priority Areas\` in \`${PRIORITIES_FILE}\`: one numbered list, most important first, one short line each, no tasks.
4. A task goes in \`${TODOS_FILE}\` as one line under the right heading.

| Information | File |
|---|---|
| Who you are, how you like answers | \`${ABOUT_ME_FILE}\` |
| What matters most now | \`${PRIORITIES_FILE}\` |
| A project's status | \`${PROJECTS_DIR}/<project>.md\` |
| A task | one line in \`${TODOS_FILE}\` |
| A raw idea | \`${INBOX_FILE}\` |
`,
  [ABOUT_ME_FILE]: `# About me

Last updated:

- Who I am:
- Languages:
- How I like answers:
`,
  [PRIORITIES_FILE]: `# Current Priorities

Last updated:

## Active Priority Areas

1. Your most important area, in one short line
`,
  [TODOS_FILE]: `# Todos

## Work

## Personal
`,
  [INBOX_FILE]: `# Braindump

`
}

/** Numbered top-level folders (`05_Tasks`, …) mean a vault in another layout, which isn't mapped yet. */
export function hasOtherLayout(root: string): boolean {
  try {
    return readdirSync(root).some((n) => /^\d\d_/.test(n) && statSync(join(root, n)).isDirectory())
  } catch {
    return false
  }
}

/** Which framework files the vault lacks. A vault in another layout gets nothing added. */
export function checkFramework(root: string): Omit<SetupCheck, 'added'> {
  const otherLayout = hasOtherLayout(root)
  const missing = otherLayout ? [] : Object.keys(TEMPLATES).filter((rel) => !existsSync(join(root, rel)))
  return { missing, otherLayout }
}

/** The missing files with their template text, re-checked against the disk now. */
export function missingFiles(root: string): { path: string; text: string }[] {
  return checkFramework(root).missing.map((path) => ({ path, text: TEMPLATES[path] }))
}

export function ensureFrameworkDirs(root: string) {
  if (hasOtherLayout(root)) return
  for (const dir of FRAMEWORK_DIRS) mkdirSync(join(root, dir), { recursive: true })
}
