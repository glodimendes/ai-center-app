// Every vault path the app knows, relative to the vault root. Code, prompts and UI texts import these
// instead of repeating literals, so a change of the vault layout is a change to this file only.

// Top level
/** Entry point for AI tools: what to load for which task, and the rules. */
export const START_FILE = 'AGENTS.md'
/** One-line pointer so Claude Code loads START_FILE (`@AGENTS.md`). */
export const CLAUDE_FILE = 'CLAUDE.md'
export const PROJECTS_DIR = 'projects'
export const WORKFLOWS_DIR = 'workflows'
export const CONTEXT_DIR = 'context'
export const TASKS_DIR = 'tasks'
export const PROMPTS_DIR = 'prompts'
export const DECISIONS_DIR = 'decisions'
export const REFERENCES_DIR = 'references'

// Rules every assistant follows (read by Update context)
export const RULES_FILE = `${WORKFLOWS_DIR}/assistant-file-update-rules.md`
export const MAINTENANCE_FILE = `${WORKFLOWS_DIR}/context-maintenance.md`

// Context
export const ABOUT_ME_FILE = `${CONTEXT_DIR}/about-me.md`
export const GOALS_FILE = `${CONTEXT_DIR}/goals-and-direction.md`
/** Its "## Active Priority Areas" list is shown in Review. */
export const PRIORITIES_FILE = `${CONTEXT_DIR}/current-priorities.md`

// Tasks (user-owned files; edited line by line)
export const TODOS_FILE = `${TASKS_DIR}/daily-todos.md`
export const INBOX_FILE = `${TASKS_DIR}/braindump-inbox.md`

// Tasks (app-owned folders; no AI edits them)
export const BRIEFS_DIR = `${TASKS_DIR}/briefs`
export const briefFile = (date: string) => `${BRIEFS_DIR}/${date}.md`
export const WEEKLY_DIR = `${TASKS_DIR}/weekly`
export const weeklyFile = (week: string) => `${WEEKLY_DIR}/${week}.md`
export const PLANNER_DIR = `${TASKS_DIR}/planner`
export const PREFERENCES_FILE = `${PLANNER_DIR}/preferences.md`
export const AGENT_OUTPUT_DIR = `${TASKS_DIR}/agent-output`
export const HANDOFFS_DIR = `${AGENT_OUTPUT_DIR}/handoffs`
export const GOALS_OUTPUT_DIR = `${AGENT_OUTPUT_DIR}/goals`
export const ARCHIVE_DIR = `${TASKS_DIR}/archive`
export const archiveFile = (year: string) => `${ARCHIVE_DIR}/done-${year}.md`
export const APP_OWNED_DIRS = [BRIEFS_DIR, WEEKLY_DIR, PLANNER_DIR, AGENT_OUTPUT_DIR, ARCHIVE_DIR]

// Prompts
export const BRIEF_PROMPT_FILE = `${PROMPTS_DIR}/daily-brief.md`
/** Default folder for agent definitions (Settings can point elsewhere). */
export const AGENTS_DIR = `${PROMPTS_DIR}/agents`
