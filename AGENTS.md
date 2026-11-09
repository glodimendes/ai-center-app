# AGENTS.md: context for AI assistants working on this repo

Read this first, then `README.md` (what the app does, planning rules) and `ROADMAP.md` (open decisions, next steps, known limits). Codex reads this file directly; Claude Code reads it via `CLAUDE.md`.

## What this is

AI Center (formerly AI Center Planner) is a macOS Electron app: a Motion-style routine organizer over the user's Markdown knowledge base ("the vault", `~/Documents/Personal Vault/AI Center/`, an Obsidian vault under git) and their calendars (macOS Calendar by default, Google directly as an option). The owner is a student at ETH Zurich who plans thesis, courses, outside work (applications, BRASA, mentoring, an education project) and hybrid training. The UI is in English; task text is mixed Portuguese/English and must be kept verbatim.

## Hard rules

1. **Never write to the real vault while developing.** `npm run dev` and `npx electron .` use `.dev-vault/` (a scratch copy with its own git, gitignored) and their own app data (`ai-center-planner-dev/`); both are forced in code, so a dev run can't open the real vault even if a settings file says so. Only the packaged app in `/Applications/AI Center.app` uses the real vault. The user runs it daily: never start a second instance against the real vault. Note: a dev run on a new day auto-runs the daily brief (Haiku, read-only Gmail) against `.dev-vault`.
2. **Vault edits are line-local.** Re-parse the file, find the target by stable id, and change only that line (`electron/main/vault/edits.ts`). Never re-serialize a vault file the app doesn't own: Obsidian, Claude, Codex and a meeting-review automation edit the same files.
3. **Files the app owns** (may rewrite whole):
   - `05_Tasks/weekly/YYYY-Www.md`: log, pins, overrides.
   - `05_Tasks/planner/preferences.md`: frontmatter only; the body is kept.
   - `05_Tasks/briefs/YYYY-MM-DD.md`: the daily brief.
   - `06_Prompts/daily-brief.md`: the brief prompt, written only from Settings.
4. **Calendar safety:**
   - Only planner-tagged events may be changed or deleted by the planner/Sync. macOS: `[planner:<id>]` in the notes, enforced inside the Swift helper too. Google: `extendedProperties.private.aiCenterPlanner`.
   - **Exception, user-approved 2026-11-09: the user's own hand edits.** The event panel (edit title/time, delete with confirm) and dragging an event on the grid call `Controller.editEvent` / `deleteEvent` → provider `userUpdate` / `userRemove` → helper `user-update` / `user-delete` (one occurrence; refuses planner events and read-only calendars). Never call these from Sync, the planner or any AI path.
   - Never write to `protectedCalendars` (Birthdays, ETH Classes…, ETH Tests, Family).
   - Sync only after the user confirms the diff dialog.
   - The user's calendar edits win: a moved planner event becomes a pin, a deleted one is dismissed (`Controller.adoptCalendarEdits`).
5. **Git commits never mention Claude**: no `Co-Authored-By: Claude` trailer and no "Claude" in messages. This applies to this repo, to the vault, and to the app's own `planner: …` commits, which use the user's identity. The user asked for this explicitly.
6. **Commit or push only when the user asks.** The repo is pushed to GitHub: never commit vault content, real task data, settings, tokens or calendar data (`.gitignore` covers the known paths; check `git status` before committing).
7. **AI must use the cheapest models**: `gpt-5.6-luna` (Codex) and `claude-haiku-5-5` (Claude), medium effort (`CONTEXT_MODELS` in `electron/main/context/agent.ts`). Don't change them without the user asking.
8. **AI never acts without the user.** The brief is read-only. Update context edits are reviewed (Keep/Undo). Suggested todos need a click.
9. The vault's own rules apply to any vault content change: `03_Workflows/assistant-file-update-rules.md` and `03_Workflows/context-maintenance.md`.
10. **Don't design the "Braindump feature"** until the user specifies it (see ROADMAP).

## Where AI is used (and where it is not)

- **Daily brief** (`electron/main/context/brief.ts`)
  - **When:** the first app open of each planning day (after 04:00), or the "Run daily brief" button.
  - **How:** runs `claude -p --model claude-haiku-5-5` inside the vault with **read-only** tools: Read/Glob/Grep on the vault, plus Gmail search/get through the user's claude.ai connectors. (Codex CLI has no Gmail access.)
  - **Calendar:** only today's events from the calendars visible in the app (`hiddenCalendars` excluded) are put into the prompt; the Google Calendar connector tools are disallowed, so the brief can't read other calendars.
  - **Prompt:** the editable instructions live in the vault at `06_Prompts/daily-brief.md` (Settings → Daily brief), with `{{date}}`, `{{calendar}}` and `{{email}}` placeholders. The fixed output format `BRIEF_FORMAT` is always appended, because the app parses its `## ` headings.
  - **Output:** the app writes `05_Tasks/briefs/YYYY-MM-DD.md` itself. TEMPORARY INBOX suggestions are added only when the user clicks Add.
- **Update context** (⌘U, `electron/main/context/agent.ts`)
  - **How:** runs `codex exec -m gpt-5.6-luna` (default) or `claude -p --model claude-haiku-5-5`, limited to file tools in the vault and following `context-maintenance.md`.
  - **Review:** the vault's text files are snapshotted first, then the user sees a per-file diff and chooses **Keep** (one commit) or **Undo** (exact restore). Cancel, an error or quitting undoes everything.
- **Everything else is deterministic code, not AI:** planning, re-planning, the rest of the Brief screen, sync diff, logging, budgets.

## Architecture

```
electron/main/
  index.ts              windows, ⌘⇧Space quick capture, IPC dispatch (ipcMain 'api' → Controller method)
  controller.ts         implements Api (shared/api.ts): vault, calendar provider, plan cache (full vs incremental),
                        calendar-edit adoption, brief runs, context runs, block editing
  settings.ts           userData/settings.json (vault path, autoCommit, calendarProvider, OAuth client, contextEngine,
                        briefAuto/briefEmail, hiddenCalendars, eventAvailability)
  vault/                parser.ts (tasks, inbox), tokens.ts (~2h, due:/by 31/10, !high, @spread/@asap, repeat:, postpone:),
                        edits.ts (line patches), service.ts (read/write/watch, brief, overrides), git.ts (batched commits),
                        preferences.ts (defaults + frontmatter, migrations), weekly.ts (log/pins/overrides/holds)
  scheduler/plan.ts     pure planner (README "Planning rules"); variants.ts: Re-plan strategies + metrics
  calendar/             provider.ts (interface), macos.ts (→ native/calendar-helper, Swift/EventKit),
                        google.ts (OAuth loopback), sync.ts (pure diff)
  context/              agent.ts (Update context + CLI resolution), brief.ts (daily brief prompt + runner)
electron/preload/       window.api.call / onState / onProgress / onBriefProgress
native/calendar-helper/ main.swift → resources/calendar-helper (npm run build:helper; bundled via electron-builder.yml)
shared/                 types.ts, api.ts (renderer↔main contract), time.ts, categories.ts (heading → area, NO_AREA),
                        repeat.ts (repeat rules: next occurrence, earliest plannable day)
src/                    React 19 + Tailwind 4 + zustand
  views/                Brief (landing), Today, Week, Tasks, Alerts, Inbox, Docs, Review, Settings (+ settings/*), Capture
  components/           TimeGrid (own grid: drag, resize, draw), BlockPanel, TaskRow, RepeatPicker, NewBlock, ReplanButton
                        (Re-plan options dialog), CalendarFilter, SyncDialog, DocEditor (Milkdown), ui
tests/                  vitest: vault, scheduler, sync, brief (fixtures = copies of real vault files, gitignored)
scripts/cdp.mjs         screenshot / eval in the running app over the DevTools protocol (port 9333)
scripts/make-icon.swift app icon → build/icon.png/.icns (npm run build:icon; electron-builder picks up build/icon.icns)
```

Data flow: the main process computes `AppState` (vault + calendar + plan + brief status) and pushes it on every change (`state` channel). The renderer calls `api.<method>()` and never touches files. To add a call, put the method in `shared/api.ts` and implement it on `Controller`; the preload proxy needs no change.

**App data** (`~/Library/Application Support/AI Center Planner/`, kept from before the rename; dev: `ai-center-planner-dev/`; both set in `electron/main/index.ts`; dev always uses `.dev-vault` even if a settings file says otherwise):
- `settings.json`
- `plan-cache.json`: last plan, so blocks stay stable across restarts.
- `sync-state.json`: what was synced, plus dismissals from calendar deletions.
- `google-tokens.bin`: Keychain-encrypted.

## Conventions

- TypeScript strict, matching the existing style: no semicolons, single quotes, 2 spaces, long lines, terse comments that explain *why*. There is no Prettier config: **don't run Prettier with defaults** (it rewrites whole files with semicolons and double quotes). Edit by hand.
- Times are local. Planner timestamps are `YYYY-MM-DDTHH:mm:00` without an offset (`localISO`); calendars return offsets, so compare via `Date`.
- Our own UI primitives (`components/ui.tsx`); no component libraries. The docs editor is Milkdown Crepe.
- New planner rules: add the field to `Preferences` (types + `DEFAULT_PREFERENCES` + `parsePreferences` merge), a Settings control, a test, and a line in README "Planning rules".

## Verify your changes

```bash
npm test              # 97 tests; must stay green
npm run typecheck
npm run build && npx electron . --remote-debugging-port=9333 &   # runs against .dev-vault
node scripts/cdp.mjs /tmp/shot.png "document.body.innerText.slice(0,300)"   # screenshot + eval in renderer
#   main-process calls from the renderer: window.api.call('<method>', ...args)
cd .dev-vault && git status && git log --oneline | head   # confirm exactly what the app wrote
npm run install-app   # build helper + package + copy to /Applications (real vault at runtime; ask the user to restart the app)
```

macOS `screencapture` is blocked in agent sandboxes; use `scripts/cdp.mjs`. The calendar permission prompt needs the user's click: test calendar features in the packaged app with the user.

## Status (2026-11-09)

**Installed and in daily use** as `/Applications/AI Center.app` (renamed from "AI Center Planner"; same bundle id `local.aicenter.planner`, app data still in `~/Library/Application Support/AI Center Planner/`). macOS Calendar access granted.

**Verified live with the user (real calendar):** Sync dry-run, syncing one block to Study Schedule, moving it in Calendar.app (became a pin). Deleting it exposed a bug (a moved-then-deleted block stayed as a pin), fixed and unit-tested; re-check it live once. Not yet confirmed: that the user's own and Codex's events stay untouched across a full Sync.

**Verified in the dev app / by tests (97 tests):** everything in README, including (2026-11-09) block resize and drawing, kept-free slots, 24 h grid, Re-plan options + Shuffle, Alerts page, Today sort/filter, repeating tasks, postpone (task and block), check-off tracking blocks, training as ordinary tasks (whole sessions, before breaks, outside the daily cap), reserved hours before other tasks, the leftover pass for 0-hour days, no-area blocks, brief limited to visible calendars.

**Installed later on 2026-11-09 (verified in the dev app, not yet watched live in the installed app):**
- **Four priority levels**: `!urgent` added above `!high` (score value 2). The flag chip in `TaskRow` cycles low (↓) → medium (outline flag, hover only) → high (↑) → urgent (red flag) and updates at once in the UI, so quick clicks aren't lost while the write is in flight.
- **Block panel checkboxes save immediately** (`BlockPanel.toggleTask`): the task is marked done/reopened, and once the block has started the log is written first (pins the block with its tasks), status done when all are checked, otherwise partial. Save/Update log is still used for time, note and remaining estimates.

**Also installed 2026-11-09:**
- **Subtasks in the Tasks view**: hover buttons add a subtask, nest a task under the one above, or move it out; Tab / ⇧Tab while editing a title. `indentTask` / `addSubtask` in `vault/edits.ts` change only the moved lines and use the file's indentation (tabs). Verified in the dev app and by tests.
- **Hand edits of calendar events** (see Hard rule 4): the user confirmed editing works in the installed app with the real calendar (2026-11-09).

**Git:** everything above is committed and pushed to `git@github.com:glodimendes/ai-center-app.git`; `main` and `ai-center-2026-11-09` both point at the same commit. Start new work on a new branch from `main`.

**Real vault content added this session:** `## TRAINING` in `05_Tasks/daily-todos.md` (8 repeating sessions), `headings: [TRAINING]` for the training area in preferences, a dated "Scheduling" note in `02_Projects/hybrid-training.md`. The app no longer reads `hybrid-training.md`.

**Open user decisions:** see ROADMAP "Open decisions". Deferred redesign: ROADMAP "Later".
