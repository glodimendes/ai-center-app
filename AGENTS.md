# AGENTS.md: context for AI assistants working on this repo

Read this first, then `README.md` (what the app does, planning rules) and `ROADMAP.md` (open decisions, next steps, known limits). Codex reads this file directly; Claude Code reads it via `CLAUDE.md`.

## What this is

AI Center (formerly AI Center Planner) is a macOS Electron app: a Motion-style routine organizer over the user's Markdown knowledge base ("the vault", `~/Documents/Personal Vault/AI Center/`, an Obsidian vault under git) and their calendars (macOS Calendar by default, Google directly as an option). The owner is a student at ETH Zurich who plans thesis, courses, outside work (applications, BRASA, mentoring, an education project) and hybrid training. The UI is in English; task text is mixed Portuguese/English and must be kept verbatim.

## Hard rules

1. **Never write to the real vault while developing.** `npm run dev` and `npx electron .` use `.dev-vault/` (a scratch copy with its own git, gitignored) and their own app data (`ai-center-planner-dev/`); both are forced in code, so a dev run can't open the real vault even if a settings file says so. Only the packaged app in `/Applications/AI Center.app` uses the real vault. The user runs it daily: never start a second instance against the real vault. Dev runs never auto-run the daily brief (`app.isPackaged` check in `maybeRunBrief`); the "Run daily brief" button still does, against `.dev-vault`.
2. **Vault edits are line-local.** Re-parse the file, find the target by stable id, and change only that line (`electron/main/vault/edits.ts`). Never re-serialize a vault file the app doesn't own: Obsidian, Claude, Codex and a meeting-review automation edit the same files.
3. **Files the app owns** (may rewrite whole):
   - `05_Tasks/weekly/YYYY-Www.md`: log, pins, overrides, the week's focus notes, its own grid hours and day-rule picks.
   - `05_Tasks/archive/done-YYYY.md`: checked tasks moved out by the weekly review; the app only appends.
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
  - **How:** runs `codex exec -m gpt-5.6-luna` (default) or `claude -p --model claude-haiku-5-5`, inside the vault and following `context-maintenance.md`. Claude is limited to file tools; Codex has no flag to disable its shell, so it runs in its `workspace-write` sandbox (writes confined to the vault, no network).
  - **Review:** the vault's text files are snapshotted first, then the user sees a per-file diff and chooses **Keep** (one commit) or **Undo**. Cancel, an error or quitting undoes it too. Undo reverts only the agent's own lines (`context/revert.ts`), so anything written to the same files since survives; a file where that can't be done with certainty is left as is and named in the toast. While a run is going, the app's own background writes wait (calendar-edit adoption, the auto brief, quick capture).
- **One-shot questions** (`electron/main/context/ask.ts`): `claude -p --model claude-haiku-5-5 --tools '' --strict-mcp-config`, so the model sees only the prompt text and can't read or change anything; it answers JSON. Used for **Suggest estimates** (Tasks view) and **Plan with a wish** (Re-plan dialog). Results are shown for approval; nothing is written without a click.
- **Everything else is deterministic code, not AI:** planning, re-planning, the rest of the Brief screen, sync diff, logging, budgets.

## Architecture

```
electron/main/
  index.ts              windows, ⌘⇧Space quick capture, IPC dispatch (ipcMain 'api' → Controller method, only names in API_METHODS)
  controller.ts         implements Api (shared/api.ts): vault, calendar provider, plan cache, applying calendar
                        edits, brief runs, block editing; delegates Update context to context/session.ts
  settings.ts           userData/settings.json (vault path, autoCommit, calendarProvider, OAuth client, contextEngine,
                        briefAuto/briefEmail, hiddenCalendars, eventAvailability)
  vault/                parser.ts (tasks, inbox), tokens.ts (~2h, due:/by 31/10, !high, @spread/@asap, repeat:, postpone:),
                        edits.ts (line patches), service.ts (read/write/watch, brief, overrides), git.ts (batched commits),
                        preferences.ts (defaults + frontmatter, migrations), weekly.ts (log/pins/overrides/holds)
  scheduler/plan.ts     pure planner (README "Planning rules"); variants.ts: Re-plan strategies + metrics;
                        cadence.ts: planning day (04:00 rollover) and full-vs-incremental decision
  calendar/             provider.ts (interface), macos.ts (→ native/calendar-helper, Swift/EventKit),
                        google.ts (OAuth loopback), sync.ts (pure diff), adopt.ts (pure: which calendar edits win)
  context/              agent.ts (CLI runs + resolution), session.ts (Update context: snapshot, diff, Keep/Undo),
                        revert.ts (undo only the agent's lines), brief.ts (daily brief prompt + runner)
electron/preload/       window.api.call / onState / onProgress / onBriefProgress
native/calendar-helper/ main.swift → resources/calendar-helper (npm run build:helper; bundled via electron-builder.yml)
shared/                 types.ts, api.ts (renderer↔main contract), time.ts, categories.ts (heading → area, NO_AREA),
                        repeat.ts (repeat rules: next occurrence, earliest plannable day)
src/                    React 19 + Tailwind 4 + zustand
  views/                Brief (landing), Today, Week, Tasks, Alerts, Inbox, Docs, Review, Settings (+ settings/*), Capture
  components/           TimeGrid (own grid: drag, resize, draw), BlockPanel (+ block-panel/: event editing, block tools),
                        TaskRow, RepeatPicker, NewBlock, ReplanButton (Re-plan options dialog), CalendarFilter, SyncDialog,
                        DocEditor (Milkdown), ui (Button, Header, Modal, Popover in a portal, useEscape)
tests/                  vitest: vault, scheduler, sync, brief, context, inbox. sample/ = synthetic files (committed);
                        fixtures/ = copies of real vault files (gitignored, optional: their tests skip when absent)
scripts/cdp.mjs         screenshot / eval in the running app over the DevTools protocol (port 9333)
scripts/make-icon.swift app icon → build/icon.png/.icns (npm run build:icon; electron-builder picks up build/icon.icns)
```

Data flow: the main process computes `AppState` (vault + calendar + plan + brief status) and pushes it on every change (`state` channel). The renderer calls `api.<method>()` and never touches files. To add a call, put the method in `shared/api.ts` and implement it on `Controller`; the preload proxy needs no change.

**App data** (`~/Library/Application Support/AI Center Planner/`, kept from before the rename; dev: `ai-center-planner-dev/`; both set in `electron/main/index.ts`; dev always uses `.dev-vault` even if a settings file says otherwise):
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
npm test              # 141 tests; must stay green (2 skip on a fresh clone without tests/fixtures/)
npm run typecheck
npm run build && npx electron . --remote-debugging-port=9333 &   # runs against .dev-vault
node scripts/cdp.mjs /tmp/shot.png "document.body.innerText.slice(0,300)"   # screenshot + eval in renderer
#   main-process calls from the renderer: window.api.call('<method>', ...args)
cd .dev-vault && git status && git log --oneline | head   # confirm exactly what the app wrote
npm run install-app   # build helper + package + sign + copy to /Applications (real vault at runtime; ask the user to restart the app)
npm run sign          # scripts/sign-app.sh: signs dist with the local cert "AI Center Dev" so TCC keeps Calendar
                      #   access across rebuilds. Warns and exits 0 if the cert is missing.
```

macOS `screencapture` is blocked in agent sandboxes; use `scripts/cdp.mjs`. The calendar permission prompt needs the user's click: test calendar features in the packaged app with the user.

## Status (2026-11-11)

**Installed and in daily use** as `/Applications/AI Center.app` (renamed from "AI Center Planner"; same bundle id `local.aicenter.planner`, app data still in `~/Library/Application Support/AI Center Planner/`). macOS Calendar access granted.

**Added 2026-11-11, second session — evaluation plan, phases 1–5** (plan: `~/.claude/plans/foamy-discovering-breeze.md`). All verified in the dev app over CDP and by tests (141); the first five commits were installed at ~21:18, the rest at the end of the session. **None watched live by the user yet.**
- **Small windows:** min window 640×480; container queries on `<main>`; icon sidebar under 900 px; header buttons drop labels; Today's list is a drawer and BlockPanel an overlay when narrow; Week columns ≥88 px with sideways scroll; popovers in a portal that flip; modals scroll. Untested: dragging a task from the narrow drawer onto the timeline (CDP can't drive HTML5 drag).
- **Data safety:** Update context undo reverts only the agent's lines (`context/revert.ts`) and the app's background writes wait during a run; an offline calendar no longer dismisses synced blocks; IPC only accepts `API_METHODS`.
- **Speed:** one push per change (was two), focus refresh at most once a minute, async plan cache, serialized git with retry and a banner on failure.
- **Routine fit (user decisions 2026-11-11):** the app owns calendar blocks (ROADMAP decision 1); routine changes must be settings, not code. → Settings **Day rules** (weekdays / "one day a week, the lightest", no-work span or cap); **Review & plan the week** (archive checked tasks to `05_Tasks/archive/done-YYYY.md`, week focus, week grid, picks, re-plan, sync).
- **Features the user picked:** projected finish per heading/task; habits `3x/week` (`scheduler/habits.ts`); **Wrap up** the day (Today); **Suggest estimates** and **Plan with a wish** (Haiku via `context/ask.ts`, no tools, approval first); **New in your todo list** (Inbox: tasks added outside the app, `seen-tasks.json`).
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

**Git:** pushed to `git@github.com:glodimendes/ai-center-app.git` through `b573074`; everything after (drag-and-drop reordering and the whole second 2026-11-11 session) is committed locally and **not pushed** — push only when the user asks. The single-day sync (`22d34de`) and the repeating-task skip (`e7e1b61`) were held back for a day and pushed on the user's go-ahead before either had been watched against the real calendar — so `main` contains two features that are installed but still unconfirmed live (see above).

**Real vault content added 2026-11-09:** `## TRAINING` in `05_Tasks/daily-todos.md` (8 repeating sessions), `headings: [TRAINING]` for the training area in preferences, a dated "Scheduling" note in `02_Projects/hybrid-training.md`. The app no longer reads `hybrid-training.md`.

**Open user decisions:** see ROADMAP "Open decisions". Deferred redesign: ROADMAP "Later".
