# AGENTS.md: context for AI assistants working on this repo

Read this first, then `README.md` (what the app does, planning rules) and `ROADMAP.md` (open decisions, next steps, known limits). Codex reads this file directly; Claude Code reads it via `CLAUDE.md`.

## What this is

AI Center Planner is a macOS Electron app: a Motion-style routine organizer over the user's Markdown knowledge base ("the vault", `~/Documents/Personal Vault/AI Center/`, an Obsidian vault under git) and their calendars (macOS Calendar by default, Google directly as an option). The owner is a student at ETH Zurich who plans thesis, courses, outside work (applications, BRASA, mentoring, an education project) and hybrid training. The UI is in English; task text is mixed Portuguese/English and must be kept verbatim.

## Hard rules

1. **Never write to the real vault while developing.** `npm run dev` and `npx electron .` use `.dev-vault/` (a scratch copy with its own git, gitignored). Only the packaged app in `/Applications` uses the real vault. The user runs that app daily, so don't start a second instance against the real vault.
2. **Vault edits are line-local.** Re-parse the file, find the target by stable id, and change only that line (`electron/main/vault/edits.ts`). Never re-serialize a vault file the app doesn't own: Obsidian, Claude, Codex and a meeting-review automation edit the same files.
3. **Files the app owns** (may rewrite whole):
   - `05_Tasks/weekly/YYYY-Www.md`: log, pins, overrides.
   - `05_Tasks/planner/preferences.md`: frontmatter only; the body is kept.
   - `05_Tasks/briefs/YYYY-MM-DD.md`: the daily brief.
   - `06_Prompts/daily-brief.md`: the brief prompt, written only from Settings.
4. **Calendar safety:**
   - Only planner-tagged events may be changed or deleted. macOS: `[planner:<id>]` in the notes, enforced inside the Swift helper too. Google: `extendedProperties.private.aiCenterPlanner`.
   - Never write to `protectedCalendars` (Birthdays, ETH Classes…, ETH Tests, Family).
   - Sync only after the user confirms the diff dialog.
   - The user's calendar edits win: a moved planner event becomes a pin, a deleted one is dismissed (`Controller.adoptCalendarEdits`).
5. **Git commits never mention Claude**: no `Co-Authored-By: Claude` trailer and no "Claude" in messages. This applies to this repo, to the vault, and to the app's own `planner: …` commits, which use the user's identity. The user asked for this explicitly.
6. **Commit or push only when the user asks.**
7. **AI must use the cheapest models**: `gpt-5.6-luna` (Codex) and `claude-haiku-5-5` (Claude), medium effort (`CONTEXT_MODELS` in `electron/main/context/agent.ts`). Don't change them without the user asking.
8. **AI never acts without the user.** The brief is read-only. Update context edits are reviewed (Keep/Undo). Suggested todos need a click.
9. The vault's own rules apply to any vault content change: `03_Workflows/assistant-file-update-rules.md` and `03_Workflows/context-maintenance.md`.
10. **Don't design the "Braindump feature"** until the user specifies it (see ROADMAP).

## Where AI is used (and where it is not)

- **Daily brief** (`electron/main/context/brief.ts`)
  - **When:** the first app open of each planning day (after 04:00), or the "Run daily brief" button.
  - **How:** runs `claude -p --model claude-haiku-5-5` inside the vault with **read-only** tools: Read/Glob/Grep on the vault, plus Gmail search/get and Google Calendar list/get through the user's claude.ai connectors. (Codex CLI has no Gmail access.)
  - **Prompt:** the editable instructions live in the vault at `06_Prompts/daily-brief.md` (Settings → Daily brief), with `{{date}}`, `{{calendar}}` and `{{email}}` placeholders. The fixed output format `BRIEF_FORMAT` is always appended, because the app parses its `## ` headings.
  - **Output:** the app writes `05_Tasks/briefs/YYYY-MM-DD.md` itself. TEMPORARY INBOX suggestions are added only when the user clicks Add.
- **Update context** (⌘U, `electron/main/context/agent.ts`)
  - **How:** runs `codex exec -m gpt-5.6-luna` (default) or `claude -p --model claude-haiku-5-5`, limited to file tools in the vault and following `context-maintenance.md`.
  - **Review:** the vault's text files are snapshotted first, then the user sees a per-file diff and chooses **Keep** (one commit) or **Undo** (exact restore). Cancel, an error or quitting undoes everything.
- **Everything else is deterministic code, not AI:** planning, re-planning, training, the rest of the Brief screen, sync diff, logging, budgets.

## Architecture

```
electron/main/
  index.ts              windows, ⌘⇧Space quick capture, IPC dispatch (ipcMain 'api' → Controller method)
  controller.ts         implements Api (shared/api.ts): vault, calendar provider, plan cache (full vs incremental),
                        calendar-edit adoption, brief runs, context runs, block editing
  settings.ts           userData/settings.json (vault path, autoCommit, calendarProvider, OAuth client, contextEngine,
                        briefAuto/briefEmail, hiddenCalendars, eventAvailability)
  vault/                parser.ts (tasks, inbox), tokens.ts (~2h, due:/by 31/10, !high, @spread/@asap),
                        edits.ts (line patches), service.ts (read/write/watch, brief, overrides), git.ts (batched commits),
                        preferences.ts (defaults + frontmatter), training.ts, weekly.ts (log/pins/overrides)
  scheduler/plan.ts     pure planner (README "Planning rules")
  calendar/             provider.ts (interface), macos.ts (→ native/calendar-helper, Swift/EventKit),
                        google.ts (OAuth loopback), sync.ts (pure diff)
  context/              agent.ts (Update context + CLI resolution), brief.ts (daily brief prompt + runner)
electron/preload/       window.api.call / onState / onProgress / onBriefProgress
native/calendar-helper/ main.swift → resources/calendar-helper (npm run build:helper; bundled via electron-builder.yml)
shared/                 types.ts, api.ts (renderer↔main contract), time.ts, categories.ts (heading → area)
src/                    React 19 + Tailwind 4 + zustand
  views/                Brief (landing), Today, Week, Tasks, Inbox, Docs, Review, Settings (+ settings/*), Capture
  components/           TimeGrid (own grid), BlockPanel, TaskRow, CalendarFilter, SyncDialog, DocEditor (Milkdown), ui
tests/                  vitest: vault, scheduler, sync, brief (fixtures = copies of real vault files, gitignored)
scripts/cdp.mjs         screenshot / eval in the running app over the DevTools protocol
```

Data flow: the main process computes `AppState` (vault + calendar + plan + brief status) and pushes it on every change (`state` channel). The renderer calls `api.<method>()` and never touches files. To add a call, put the method in `shared/api.ts` and implement it on `Controller`; the preload proxy needs no change.

**App data** (`~/Library/Application Support/AI Center Planner/`, dev: `ai-center-planner/`):
- `settings.json`
- `plan-cache.json`: last plan, so blocks stay stable across restarts.
- `sync-state.json`: what was synced, plus dismissals from calendar deletions.
- `google-tokens.bin`: Keychain-encrypted.

## Conventions

- TypeScript strict, matching the existing style: no semicolons, single quotes, 2 spaces, terse comments that explain *why*.
- Times are local. Planner timestamps are `YYYY-MM-DDTHH:mm:00` without an offset (`localISO`); calendars return offsets, so compare via `Date`.
- Our own UI primitives (`components/ui.tsx`); no component libraries. The docs editor is Milkdown Crepe.
- New planner rules: add the field to `Preferences` (types + `DEFAULT_PREFERENCES` + `parsePreferences` merge), a Settings control, a test, and a line in README "Planning rules".

## Verify your changes

```bash
npm test              # 68 tests; must stay green
npm run typecheck
npm run build && npx electron . --remote-debugging-port=9333 &   # runs against .dev-vault
node scripts/cdp.mjs /tmp/shot.png "document.body.innerText.slice(0,300)"   # screenshot + eval in renderer
#   main-process calls from the renderer: window.api.call('<method>', ...args)
cd .dev-vault && git status && git log --oneline | head   # confirm exactly what the app wrote
npm run install-app   # build helper + package + copy to /Applications (real vault at runtime; ask the user to restart the app)
```

macOS `screencapture` is blocked in agent sandboxes; use `scripts/cdp.mjs`. The calendar permission prompt needs the user's click: test calendar features in the packaged app with the user.

## Status (2026-11-08)

**Verified in the app (dev vault):**
- vault parsing and line-local edits;
- scheduler: weighted score, weekly hours grid, ASAP/spread, finer rules, stable incremental re-planning;
- all screens;
- time logging, pins and drag;
- block editing: add a task to a block, remove a task, remove a block with Undo;
- Update context (Codex and Claude);
- in-app daily brief (Haiku, read-only Gmail);
- packaging.

**In use on the real vault:** the user uses the installed app daily (vault commits `planner: …`, preferences file created). macOS Calendar access is granted: the plan contains container blocks from their events.

**Not yet verified live:** Sync to calendar (create/move/delete of tagged events) and edit adoption (move or delete in Calendar.app). Do it with the user, starting with one block.

**Open user decisions:** see ROADMAP "Open decisions".
