# AGENTS.md: context for AI assistants working on this repo

Read this first, then `README.md` (what the app does, planning rules) and `ROADMAP.md` (open decisions, next steps, known limits). Codex reads this file directly; Claude Code reads it via `CLAUDE.md`.

## What this is

AI Center (formerly AI Center Planner) is a macOS Electron app: a Motion-style routine organizer over the user's Markdown knowledge base ("the vault", `~/Documents/Personal Vault/AI Center/`, an Obsidian vault under git) and their calendars (macOS Calendar by default, Google directly as an option). The owner is a student at ETH Zurich who plans thesis, courses, outside work (applications, BRASA, mentoring, an education project) and hybrid training. The UI is in English; task text is mixed Portuguese/English and must be kept verbatim.

## Two lines of work (since 2026-11-21): this folder is the expansion

This folder is the git worktree `/Users/glodimendes/Programming/AI-Center-core` on branch **`ai-center-core`**: the general AI Center agent hub. **Plan (read it first): `~/.claude-eth/plans/sequential-questing-sundae.md`** (phases 0–7, user decisions, safety rules). The stable planner lives on `main` in `/Users/glodimendes/Programming/AI-Center`, where the user keeps improving it and from where the installed app is built.
- **Here:** expansion work only. Don't run `npm run install-app` from this folder unless the user asks. Never commit vault content or personal data (hard rule 6 applies; the repo is public-bound).
- **Stay current with `main`:** before starting a phase, and whenever the user says they changed the planner, run `git merge main` (or rebase) in this folder and rerun `npm test` and `npm run typecheck`. Resolve conflicts in favour of keeping planner behaviour identical; Phase 0 must not change behaviour.
- **Keep the core separable:** new code under `electron/main/agents/` must not import Electron or UI, and the planner must stay usable as a module of the core (plan, Phase 1 and 6).
- **Separate dev instance:** use its own dev app-data folder and debug port from `main` (Phase 0 task), so both dev apps can run together.

### Start here (handoff, 2026-11-21)

State (2026-11-21): **Phase 0** (`1a8b683`) and **Phase 1** (`71155c3`) are committed. **Phase 2 is written, verified live in the dev app, uncommitted**: window usage per account (Claude: `rate_limit_event` in the stream-json run output, `utilization` is a 0..1 fraction; Codex: `rate_limits` in `~/.codex/sessions` logs, read-only), budget ceiling per profile (`AccountProfile.sharePct`, default 70, per-agent `budget` overrides) enforced by `Supervisor`'s gate: above it a run is `paused` and the user picks Allow once / Allow and raise (+20) / Skip; usage totals per agent per day/week from `runs/*.jsonl`; Settings → Engines & accounts (CLI versions, profiles with `configDir`, ceiling, Test, bars); `Settings.profiles` (unset = `claude`, `codex`). Tests: `tests/usage.test.ts` (+ agents/engines) pass; live: Test button, pause and Allow once.
Caveats: the ceiling is on the whole account's window (Claude reports no agent-only share). Claude numbers refresh only after an agent run or Test (the personal `~/.claude` account returned no limit event when probed; probably not logged in). Built-in paths (brief, Update context, estimates) don't go through the gate yet and don't update limits. Older run logs have no `profile`.
**Phase 1 recap:** Agents view (⌘9), `agent-hub.ts`, definitions in `06_Prompts/agents/`, approvals inbox. Not done: file watching, "New agent from this run", executors for create-event/email-draft/api-call, data sources.
**User preferences:** run tests/typecheck without asking, but keep them minimal (targeted files, once).
Next: Phase 3 (triggers, ⌘⇧Space `@agent` routing, data sources, Email triage / Training coach / Task automation agents) after committing Phase 2.
1. Read the plan (`~/.claude-eth/plans/sequential-questing-sundae.md`) before each phase; run `git merge main` first.
2. Account facts: Claude `~/.claude` = personal (default for built-ins), `~/.claude-eth` = ETH; Codex `~/.codex`; the Antigravity CLI binary is `agy` (v1.5.9; `-p`, `--output-format stream-json`, `--model`, `--effort`, `--mode`, `acp` subcommand). `gemini` isn't installed.
3. Nothing is pushed: `ai-center-core` is local only. Push only when the user asks.
4. Ask the user before long refactors of `controller.ts`; keep commits small and per step so `main` can be merged in without pain.

### Uniting the two lines (when the user is ready)

Do this only when the user asks. Steps:
1. In `AI-Center`, make sure `main` is committed and tests are green; note its last commit.
2. In `AI-Center-core`: `git merge main`, resolve conflicts, `npm test`, `npm run typecheck`, then run the dev app and check the brief, Update context, Suggest estimates and Plan with a wish against `.dev-vault`.
3. Check the migration: existing `settings.json` (`contextEngine`, `askEngine`) must load into the new account profiles, and `06_Prompts/daily-brief.md` must keep working as the built-in Daily brief agent; the app data folder stays `AI Center Planner/` so Calendar permission, plan cache and sync state carry over.
4. Merge `ai-center-core` into `main` (fast-forward after step 2 if possible), push only when the user asks, then `npm run install-app` and ask the user to restart and watch a daily brief and one custom agent on real data.
5. Remove the worktree (`git worktree remove ../AI-Center-core`) and the branch only after the user confirms. Update this section, `ROADMAP.md` and `main`'s `AGENTS.md`.
Commit messages follow hard rule 5 (no mention of Claude).

## Hard rules

1. **Never write to the real vault while developing.** `npm run dev` and `npx electron .` use `.dev-vault/` (a scratch copy with its own git, gitignored) and their own app data (`ai-center-core-dev/` on this branch; `main` uses `ai-center-planner-dev/`); both are forced in code, so a dev run can't open the real vault even if a settings file says so. Only the packaged app in `/Applications/AI Center.app` uses the real vault. The user runs it daily: never start a second instance against the real vault. Dev runs never auto-run the daily brief (`app.isPackaged` check in `maybeRunBrief`); the "Run daily brief" button still does, against `.dev-vault`.
2. **Vault edits are line-local.** Re-parse the file, find the target by stable id, and change only that line (`electron/main/vault/edits.ts`). Never re-serialize a vault file the app doesn't own: Obsidian, Claude, Codex and a meeting-review automation edit the same files.
3. **Files the app owns** (may rewrite whole):
   - `05_Tasks/weekly/YYYY-Www.md`: log, pins, overrides, the week's focus notes, its own grid hours and day-rule picks.
   - `05_Tasks/archive/done-YYYY.md`: checked tasks moved out by the weekly review; the app only appends.
   - `05_Tasks/planner/preferences.md`: frontmatter only; the body is kept.
   - `05_Tasks/briefs/YYYY-MM-DD.md`: the daily brief.
   - `06_Prompts/daily-brief.md`: the brief prompt, written only from Settings.
   - `06_Prompts/agents/*.md` (or `settings.agentsDir`): custom agent definitions, written only from the Agents view. `05_Tasks/agent-output/<agent>/`: answers of agents with `output: file`, written by the app, never by the agent.
4. **Calendar safety:**
   - Only planner-tagged events may be changed or deleted by the planner/Sync. macOS: `[planner:<id>]` in the notes, enforced inside the Swift helper too. Google: `extendedProperties.private.aiCenterPlanner`.
   - **Exception, user-approved 2026-11-09: the user's own hand edits.** The event panel (edit title/time, delete with confirm) and dragging an event on the grid call `Controller.editEvent` / `deleteEvent` → provider `userUpdate` / `userRemove` → helper `user-update` / `user-delete` (one occurrence; refuses planner events and read-only calendars). Never call these from Sync, the planner or any AI path.
   - Never write to `protectedCalendars` (Birthdays, ETH Classes…, ETH Tests, Family).
   - Sync only after the user confirms the diff dialog.
   - The user's calendar edits win: a moved planner event becomes a pin, a deleted one is dismissed (`Controller.adoptCalendarEdits`).
5. **Git commits never mention Claude**: no `Co-Authored-By: Claude` trailer and no "Claude" in messages. This applies to this repo, to the vault, and to the app's own `planner: …` commits, which use the user's identity. The user asked for this explicitly.
6. **Commit or push only when the user asks.** The repo is pushed to GitHub: never commit vault content, real task data, settings, tokens or calendar data (`.gitignore` covers the known paths; check `git status` before committing).
7. **Built-in AI uses the cheapest models**: `gpt-5.6-luna` (Codex) and `claude-haiku-5-5` (Claude), medium effort (`CONTEXT_MODELS` in `electron/main/agents/engines/models.ts`). Don't change them without the user asking. A custom agent's model is the user's choice, set in its definition.
8. **AI never acts without the user.** Each agent has a permission level: `read` (answers only), `propose` (edits reviewed with Keep/Undo) or `act`. Even `act` may at most write the agent's own output files and add/edit tasks. **Completing a task, creating a calendar event, sending email and calling an API always need the user's click**: agents only propose these (Approvals inbox, Phase 1), and code enforces it, never the prompt. Today: the brief is read-only, Update context edits are reviewed, suggested todos need a click.
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
  - **How:** runs `codex exec -m gpt-5.6-luna` (default) or `claude -p --model claude-haiku-5-5`, inside the vault and following `context-maintenance.md`. Claude is limited to file tools; Codex has no flag to disable its shell, so it runs in its `workspace-write` sandbox (writes confined to the vault, no network).
  - **Review:** the vault's text files are snapshotted first, then the user sees a per-file diff and chooses **Keep** (one commit) or **Undo**. Cancel, an error or quitting undoes it too. Undo reverts only the agent's own lines (`context/revert.ts`), so anything written to the same files since survives; a file where that can't be done with certainty is left as is and named in the toast. While a run is going, the app's own background writes wait (calendar-edit adoption, the auto brief, quick capture).
- **One-shot questions** (`electron/main/context/ask.ts`): by default `claude -p --model claude-haiku-5-5 --tools '' --strict-mcp-config`, so the model sees only the prompt text and can't read or change anything; it answers JSON. Settings → `askEngine` can switch them to Codex (`codex exec -m gpt-5.6-luna -s read-only` from an empty temp folder: no writes, no network, but its shell can't be turned off). Used for **Suggest estimates** (Tasks view) and **Plan with a wish** (Re-plan dialog). Results are shown for approval; nothing is written without a click.
- **Everything else is deterministic code, not AI:** planning, re-planning, the rest of the Brief screen, sync diff, logging, budgets.

## Architecture

```
electron/main/
  index.ts              windows, ⌘⇧Space quick capture, IPC dispatch (ipcMain 'api' → Controller method, only names in API_METHODS)
  controller.ts         implements Api (shared/api.ts): vault, calendar provider, plan cache, applying calendar
                        edits, brief runs, block editing; delegates Update context to context/session.ts
  settings.ts           userData/settings.json (vault path, autoCommit, calendarProvider, OAuth client, contextEngine,
                        briefAuto/briefEmail, hiddenCalendars, eventAvailability)
  vault/                parser.ts (tasks, inbox), tokens.ts (~2h, due:/by 31/10, !high, @spread/@asap, repeat:, postpone:, 3x/week),
                        edits.ts (line patches, takeDone for the archive), service.ts (read/write/watch, brief, overrides,
                        archive, week picks/grid/notes/wishes), git.ts (batched, serialized commits with retry),
                        preferences.ts (defaults + frontmatter, migrations, dayRules), weekly.ts (log/pins/overrides/holds/notes)
  scheduler/plan.ts     pure planner (README "Planning rules"); variants.ts: Re-plan strategies + metrics;
                        cadence.ts: planning day (04:00 rollover) and full-vs-incremental decision; habits.ts: `3x/week`
                        → per-week sessions (ids `<task>@<week>#n`, mapped back before plan() returns); wish.ts: "Plan with
                        a wish" prompt, validation, and writing it into week overrides; day rules live inside plan.ts
  calendar/             provider.ts (interface), macos.ts (→ native/calendar-helper, Swift/EventKit),
                        google.ts (OAuth loopback), sync.ts (pure diff), adopt.ts (pure: which calendar edits win)
  agent-hub.ts          app glue: runs agents through the supervisor, review via ContextSession, executes approved actions
  agents/               core, no Electron/UI imports: definition.ts (Markdown+frontmatter), registry.ts, permissions.ts, actions.ts
                        (ApprovalStore: only approve() runs an executor), supervisor.ts (queue, concurrency 1, budget pause, runs/*.jsonl),
                        usage.ts (window limits, budget check, run totals), runner.ts;
                        engines/ (types, process: spawn+stream+timeout+profile env, claude-cli, codex-cli,
                        models), profiles.ts (account profiles; default = each CLI's own login)
  context/              agent.ts (Update context run + vault snapshot), session.ts (Update context: snapshot, diff, Keep/Undo),
                        revert.ts (undo only the agent's lines), brief.ts (daily brief prompt + runner),
                        ask.ts (one-shot Haiku question, no tools, JSON answer: estimates, wishes)
electron/preload/       window.api.call / onState / onProgress / onBriefProgress
native/calendar-helper/ main.swift → resources/calendar-helper (npm run build:helper; bundled via electron-builder.yml)
shared/                 types.ts, api.ts (renderer↔main contract), time.ts, categories.ts (heading → area, NO_AREA),
                        repeat.ts (repeat rules: next occurrence, earliest plannable day)
src/                    React 19 + Tailwind 4 + zustand
  views/                Brief (landing), Today, Week, Tasks, Alerts, Inbox, Docs, Review, Settings (+ settings/*: areas,
                        strategy, heading map, brief prompt, DayRules), Capture
  components/           TimeGrid (own grid: drag, resize, draw), BlockPanel (+ block-panel/: event editing, block tools),
                        TaskRow, RepeatPicker, NewBlock, ReplanButton (Re-plan options dialog), CalendarFilter, SyncDialog,
                        DocEditor (Milkdown), WeeklyReview (Review → "Review & plan the week"), Shutdown (Today → Wrap up),
                        EstimateSuggestions (Tasks), ui (Button, Header, Modal, Popover in a portal, useEscape)
tests/                  vitest: vault, scheduler, sync, brief, context, inbox. sample/ = synthetic files (committed);
                        fixtures/ = copies of real vault files (gitignored, optional: their tests skip when absent)
scripts/cdp.mjs         screenshot / eval in the running app over the DevTools protocol (port 9334 on this branch via `CDP_PORT`, `main` uses 9333)
scripts/make-icon.swift app icon → build/icon.png/.icns (npm run build:icon; electron-builder picks up build/icon.icns)
```

Data flow: the main process computes `AppState` (vault + calendar + plan + brief status) and pushes it on every change (`state` channel). The renderer calls `api.<method>()` and never touches files. To add a call, put the method in `shared/api.ts` and implement it on `Controller`; the preload proxy needs no change.

**App data** (`~/Library/Application Support/AI Center Planner/`, kept from before the rename; dev: `ai-center-core-dev/` here, `ai-center-planner-dev/` on `main`; both set in `electron/main/index.ts`; dev always uses `.dev-vault` even if a settings file says otherwise):
- `settings.json`
- `plan-cache.json`: last plan, so blocks stay stable across restarts.
- `sync-state.json`: what was synced, plus dismissals from calendar deletions.
- `seen-tasks.json`: task ids the app created or the user reviewed; any other open task is "new in your todo list" (Inbox). Seeded with everything on first run.
- `google-tokens.bin`: Keychain-encrypted.

## Conventions

- TypeScript strict, matching the existing style: no semicolons, single quotes, 2 spaces, long lines, terse comments that explain *why*. There is no Prettier config: **don't run Prettier with defaults** (it rewrites whole files with semicolons and double quotes). Edit by hand.
- Times are local. Planner timestamps are `YYYY-MM-DDTHH:mm:00` without an offset (`localISO`); calendars return offsets, so compare via `Date`.
- Our own UI primitives (`components/ui.tsx`); no component libraries. The docs editor is Milkdown Crepe.
- New planner rules: add the field to `Preferences` (types + `DEFAULT_PREFERENCES` + `parsePreferences` merge), a Settings control, a test, and a line in README "Planning rules".

## Verify your changes

```bash
npm test              # 145 tests; must stay green (2 skip on a fresh clone without tests/fixtures/)
npm run typecheck
npm run build && npx electron . --remote-debugging-port=9334 &   # runs against .dev-vault
node scripts/cdp.mjs /tmp/shot.png "document.body.innerText.slice(0,300)"   # screenshot + eval in renderer
#   main-process calls from the renderer: window.api.call('<method>', ...args)
cd .dev-vault && git status && git log --oneline | head   # confirm exactly what the app wrote
npm run install-app   # build helper + package + sign + copy to /Applications (real vault at runtime; ask the user to restart the app)
npm run sign          # scripts/sign-app.sh: signs dist with the local cert "AI Center Dev" so TCC keeps Calendar
                      #   access across rebuilds. Warns and exits 0 if the cert is missing.
```

macOS `screencapture` is blocked in agent sandboxes; use `scripts/cdp.mjs`. The calendar permission prompt needs the user's click: test calendar features in the packaged app with the user.

## Status (2026-11-11)

**Start here next session:**
1. Ask the user how the installed app behaved on real data, especially: **checking off a repeating task inside a block** (third-session fix below), archiving checked tasks in the weekly review, a day rule, a habit, a wish with focus, and the narrow-window drawer drag (ROADMAP "Next" has the full list).
2. The third- and fourth-session commits (repeat fix, Codex for one-shot questions, macOS Calendar fetch, subtask inheritance) are committed locally, **not pushed**. Push only when the user asks.
3. The user still has setup to do in Settings and in Codex (ROADMAP "Next" → "User's own setup"); don't do it for them in code.
4. If they want more features, the Sunsama-style list in ROADMAP is what was offered; ask which, and keep routine-specific behaviour configurable (Settings), not hard-coded.

**Installed and in daily use** as `/Applications/AI Center.app` (renamed from "AI Center Planner"; same bundle id `local.aicenter.planner`, app data still in `~/Library/Application Support/AI Center Planner/`). macOS Calendar access granted.

**Added 2026-11-11, fourth session — subtasks inherit deadline and timing (installed 2026-11-11 ~23:05; user confirmed spread subtasks work on real data):**
- **Parser:** a subtask without its own `due:` / `@spread` / `@asap` takes its nearest ancestor's, flagged `dueFromParent` / `timingFromParent` (never written to the line; repeating tasks and habits keep their own `due`). TaskRow shows inherited values muted and its timing button cycles only the line's own token; Brief/Review "due"/"slipped" lists skip inherited dates so a parent's deadline isn't listed once per subtask.
- **Planner:** spread leaf subtasks under the same root task (same due, same area) share one even daily amount (`shares` in `plan.ts`), filled in queue order, so parts follow each other across the days. Tests: `vault.test.ts` inheritance, `scheduler.test.ts` "spreads the subtasks of a spread task…" (fails without the grouping).
- **Known limit, unchanged:** tasks under a heading mapped to no area ("Other") only get leftover time, where spread doesn't apply.

**Added 2026-11-11, fourth session — macOS Calendar pulls web edits (installed 2026-11-11 ~22:45; user confirmed live: Google web edits show up without opening Calendar.app):**
- **Bug (reported by the user):** an event changed on the Google Calendar website only reached the app after Calendar.app was opened. EventKit reads the local Calendar database, and CalendarAgent may not fetch from Google until Calendar.app runs.
- **Fix:** helper command `refresh [seconds]` calls `refreshSourcesIfNecessary()` and waits for `EKEventStoreChanged` (1.5 s quiet, 10 s cap). `Controller.pullRemote` runs it after each calendar refresh (focus, 10-min timer; at most every 30 s) and refreshes again if something changed; `syncPreview` awaits it first so the diff sees web edits. The dev helper has no Calendar access, so this is only typechecked: confirm on the installed app that a web edit appears within ~10 s of focusing the window.

**Added 2026-11-11, third session (installed ~end of session, NOT yet watched live):**
- **Bug fix — checking off a repeating task inside a block** (reported by the user): the block flipped to the next occurrence, unchecked, and a second click completed that one too. Cause: check-off inserted the next occurrence *above* the checked line, and task ids are `file|heading|title#n` (n counts same-titled tasks in order), so the new open copy took over the id the block/pin/log referred to. Now `patchTask` (`vault/edits.ts`) puts the next occurrence **below the task's subtree**: the checked line keeps the id, the new copy gets a fresh one (marked seen via `onOwnTaskIds`, so it isn't "new in your todo list") and is planned on its own date. Unchecking right after removes that copy again, only if it is still byte-identical to what check-off wrote. `Controller.completeTask` now lists repeating tasks in its ✓ block too. Verified by 4 tests and live in the dev app (pinned started block → check → block shows it done, next copy in a later block; uncheck restores the file exactly).
- **Codex for one-shot questions:** `Settings.askEngine` (`'claude'` default | `'codex'`), Settings → Vault. `askJson(engine, prompt)` in `context/ask.ts`; Codex runs `codex exec -m CONTEXT_MODELS.codex.model -s read-only` from an empty temp dir and reads `-o last.txt`. UI texts name the chosen engine via `askerName` (`src/lib/util.ts`). Verified live in the dev app: Suggest estimates (78 answers, ~30 s) and Plan with a wish both worked through Codex.

**Added 2026-11-11, second session — evaluation plan, phases 1–5** (plan: `~/.claude/plans/foamy-discovering-breeze.md`). All verified in the dev app over CDP and by tests (142). **Everything is installed** in `/Applications/AI Center.app` (last install 2026-11-11 ~22:05, `50c3217`: wish focus on a heading). The user has tried only the collapsed sidebar (dev run) and "Plan with a wish" (which failed, then got fixed); **everything else is unwatched live** — see ROADMAP "Next".
- **Small windows:** min window 640×480; container queries on `<main>`; icon sidebar under 900 px (84 px wide, expand button at the top; the macOS window buttons are pinned at x 12 via `trafficLightPosition` so they sit over the rail with 12 px on each side — change both together); header buttons drop labels; Today's list is a drawer and BlockPanel an overlay when narrow; Week columns ≥88 px with sideways scroll; popovers in a portal that flip; modals scroll. Untested: dragging a task from the narrow drawer onto the timeline (CDP can't drive HTML5 drag).
- **Data safety:** Update context undo reverts only the agent's lines (`context/revert.ts`) and the app's background writes wait during a run; an offline calendar no longer dismisses synced blocks; IPC only accepts `API_METHODS`.
- **Speed:** one push per change (was two), focus refresh at most once a minute, async plan cache, serialized git with retry and a banner on failure.
- **Routine fit (user decisions 2026-11-11):** the app owns calendar blocks (ROADMAP decision 1); routine changes must be settings, not code. → Settings **Day rules** (weekdays / "one day a week, the lightest", no-work span or cap); **Review & plan the week** (archive checked tasks to `05_Tasks/archive/done-YYYY.md`, week focus, week grid, picks, re-plan, sync).
- **Features the user picked:** projected finish per heading/task; habits `3x/week` (`scheduler/habits.ts`); **Wrap up** the day (Today); **Suggest estimates** and **Plan with a wish** (Haiku via `context/ask.ts`, no tools, approval first; a wish can be date limits, a day's area hours, a strategy, or **focus time on a todo heading** → pinned `wish:` blocks holding only that heading's tasks); **New in your todo list** (Inbox: tasks added outside the app, `seen-tasks.json`).
- **Still for the user (not code):** in Settings move headings Work / Work application / Mentoria / Masters to Outside work, put Training's 07–09 window first, drop the DMS heading; turn off the Codex `plan-next-eth-week` and Saturday weekly-review automations once the in-app versions are trusted; turn on/edit the sample "Lighter half-day" rule. Vault docs to fix via Update context with the user's OK: `03_Workflows/daily-planning.md` ("no dated plan files"), the wrong vault path in `03_Workflows/daily-brief.md`, training Day 1 / Day 3 tasks missing.

**Added 2026-11-10 — single-day sync (installed, NOT yet watched live):**
- **What:** Today's header has a **Sync day** button that syncs only the day the view is showing. The week's **Sync to calendar** is unchanged and still covers the whole `syncDays` window.
- **How:** one optional argument threaded through, no parallel code path — `buildSyncDiff(..., day?)` narrows the window to that one local day, `Controller.syncPreview(day?)` passes it, `SyncDialog` takes an optional `day` prop and titles itself with it. `syncApply` is untouched: the ops already carry everything, so there is deliberately no day-specific apply.
- **Semantics:** a single-day diff only creates/moves/deletes planner events **inside that day**. Leftover planner events on other days are intentionally left alone, so syncing one day never cleans up another.
- **Watch out:** the window must be built with `parseDate(day)` from `shared/time.ts`, never `new Date(day)` — a bare `YYYY-MM-DD` parses as **UTC**, which in CET shifted the window to 01:00 and silently dropped blocks between midnight and 01:00. `tests/sync.test.ts` → "covers the whole local day, midnight included" fails if anyone reintroduces this.
- **Verified:** 7 new unit tests (104 total) and live in the dev app over CDP — day-scoped previews are a strict subset of the full window (full 29 / Nov 10 → 6 / Nov 11 → 4 / unplanned day → 0), and the dialog renders "Sync Tuesday, Nov 10". The dev app has no calendar access, so **the real write path for a single day has not been exercised yet**: confirm on the installed app that syncing one day leaves the other days' planner events in place.

**Added 2026-11-10 — skip one occurrence of a repeating task (installed 2026-11-11, NOT yet watched live):**
- **Why:** a repeating task is a single line (`repeat:` + `due:`), so the Today trash called `deleteTask` and took the **whole series** with it. Reported by the user.
- **What:** in **Today** the trash on an open repeating task now skips just that occurrence — `Controller.skipOccurrence` moves `due:` to `nextOccurrence` and clears `postpone:`, nothing is marked done, and the toast offers Undo. The **Tasks view is unchanged** and still deletes the series; that split was the user's choice (2026-11-10), with no confirm dialog anywhere. `TaskRow` takes a `skipRepeats` prop that only Today passes.
- **Not a completion:** a skip must never write `[x]` or a log entry, or skipped occurrences would count as work done.
- **Verified:** unit tests (107) plus a live dev run — skipping moved `due:2026-11-16` → `due:2026-11-23` in `daily-todos.md` as a **one-line** commit (`planner: skip one "…"`), the line count unchanged, and Today showed "Skip this one (every week — the series stays)" while the Tasks view kept plain "Delete".
- **Design note:** `nextOccurrence` is a *catch-up* repeater (org-mode `++`): it steps from the current due date until past today, so a late check-off never spawns overdue copies. There is deliberately no "count from the completion date" style (org `.+` / Obsidian Tasks `when done`) — proposed in ROADMAP "Ideas", not approved.

**Added 2026-11-11 — the packaged app is signed:**
- **Why:** the bundle was only ad-hoc, linker-signed (`Identifier=Electron`, no sealed resources), so its code hash changed on every build. macOS TCC identifies an unsigned app by that hash, so every `install-app` looked like a new app and Calendar access had to be granted again.
- **What:** `scripts/sign-app.sh` signs nested code bottom-up (frameworks, the four Electron helper apps, `calendar-helper`) and then the bundle, with the user's self-signed Code Signing certificate **"AI Center Dev"** in their login keychain (override with `AI_CENTER_SIGN_IDENTITY`). `install-app` = package → sign → copy; `npm run sign` signs `dist` alone.
- **It signs with the certificate's SHA-1 hash, not its name**: a self-signed root is untrusted, so `security find-identity -v` hides it (`CSSMERR_TP_NOT_TRUSTED`) even though `codesign` uses it fine. Trusting the certificate is optional and was not done.
- **Missing certificate is not an error:** the script warns and exits 0, so packaging still works on another machine. An *expired* certificate does fail the build — this one runs out **2027-11-11**.
- **One-off cost:** changing the signing identity resets the TCC grant, so the user has to allow Calendar access once more after the 2026-11-11 install (not yet confirmed — they had not reopened the app). From the next install on it should persist; that persistence is the whole point and is itself unverified until a second signed install.
- **Verified:** the installed bundle now reports `Identifier=local.aicenter.planner`, `Authority=AI Center Dev`, `Sealed Resources version=2 rules=13 files=13`, and passes `codesign --verify --strict`. Still not an Apple Developer ID, so Gatekeeper may ask for right-click → Open once per bundle.

**Added 2026-11-11 — drag-and-drop task reordering (installed, NOT yet watched live):**
- **What:** in **Tasks**, dragging a task onto another task (above/below its midline) reorders it among its siblings — same parent, same section. The grip handle already used for Today's drag-onto-calendar now also works as a reorder handle in the Tasks view; Today's own drag behavior is unchanged (a separate prop — `onReorder` is only passed in Tasks).
- **How:** `electron/main/vault/edits.ts` → `reorderTask(text, file, taskId, targetId, position, categories, today)` moves only the dragged task's subtree lines to sit right before/after the target, refusing moves across a different parent or section (`TargetMissingError`). Wired through `VaultService.reorderTask` → `Controller.reorderTask` → `Api.reorderTask`, no preload change needed. `TaskRow` gained an `onReorder` prop (with a before/after drop-line highlight); `TaskTree` takes a new `reorderable` prop that `Tasks.tsx` passes.
- **Verified:** 4 new unit tests (111 total) and a live dev run over CDP — dragging "Submit thesis registration…" onto "Hand-check actor groups…" reordered it in the Tasks view and wrote a one-line-moved commit (`planner: reorder "Submit thesis registration…"`) in `.dev-vault`; Today's existing drag-to-calendar still worked unaffected.
- **Not yet done:** the code is **uncommitted** in this repo as of this entry. The feature is already in the **installed app** (`npm run install-app` run 2026-11-11 ~16:53, after this was built), but dragging to reorder hasn't been tried there yet — only in the dev vault.

**Verified live with the user (real calendar):** Sync dry-run, syncing one block to Study Schedule, moving it in Calendar.app (became a pin). Deleting it exposed a bug (a moved-then-deleted block stayed as a pin), fixed and unit-tested; re-check it live once. Not yet confirmed: that the user's own and Codex's events stay untouched across a full Sync.

**Verified in the dev app / by tests (107 tests):** everything in README, including (2026-11-09) block resize and drawing, kept-free slots, 24 h grid, Re-plan options + Shuffle, Alerts page, Today sort/filter, repeating tasks, postpone (task and block), check-off tracking blocks, training as ordinary tasks (whole sessions, before breaks, outside the daily cap), reserved hours before other tasks, the leftover pass for 0-hour days, no-area blocks, brief limited to visible calendars.

**Installed later on 2026-11-09 (verified in the dev app, not yet watched live in the installed app):**
- **Four priority levels**: `!urgent` added above `!high` (score value 2). The flag chip in `TaskRow` cycles low (↓) → medium (outline flag, hover only) → high (↑) → urgent (red flag) and updates at once in the UI, so quick clicks aren't lost while the write is in flight.
- **Block panel checkboxes save immediately** (`BlockPanel.toggleTask`): the task is marked done/reopened, and once the block has started the log is written first (pins the block with its tasks), status done when all are checked, otherwise partial. Save/Update log is still used for time, note and remaining estimates.

**Also installed 2026-11-09:**
- **Subtasks in the Tasks view**: hover buttons add a subtask, nest a task under the one above, or move it out; Tab / ⇧Tab while editing a title. `indentTask` / `addSubtask` in `vault/edits.ts` change only the moved lines and use the file's indentation (tabs). Verified in the dev app and by tests.
- **Hand edits of calendar events** (see Hard rule 4): the user confirmed editing works in the installed app with the real calendar (2026-11-09).

**Git:** everything is committed and pushed to `git@github.com:glodimendes/ai-center-app.git` (2026-11-11, end of the second session) — push only when the user asks. Before that push, two unpushed commit messages that named the model were reworded (hard rule 5), so hashes from that session differ from any noted earlier. The single-day sync (`22d34de`) and the repeating-task skip (`e7e1b61`) were held back for a day and pushed on the user's go-ahead before either had been watched against the real calendar — so `main` contains two features that are installed but still unconfirmed live (see above).

**Real vault content added 2026-11-09:** `## TRAINING` in `05_Tasks/daily-todos.md` (8 repeating sessions), `headings: [TRAINING]` for the training area in preferences, a dated "Scheduling" note in `02_Projects/hybrid-training.md`. The app no longer reads `hybrid-training.md`.

**Open user decisions:** see ROADMAP "Open decisions". Deferred redesign: ROADMAP "Later".
