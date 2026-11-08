# AGENTS.md: context for AI assistants working on this repo

Read this first, then `README.md` (what the app is) and `ROADMAP.md` (what's next). Codex reads this file directly; Claude Code reads it via `CLAUDE.md`.

## What this is

AI Center Planner is an Electron desktop app: a Motion-style routine organizer over the user's Markdown knowledge base ("the vault", `~/Documents/Personal Vault/AI Center/`, an Obsidian vault under git) and Google Calendar. The owner is a student at ETH Zurich who plans thesis, courses, outside work and training. The UI is in English, but task text is mixed Portuguese/English. Keep it verbatim.

## Hard rules

1. **Never write to the real vault while developing.** `npm run dev` / `npx electron .` use `.dev-vault/` (a scratch copy with its own git). Only the packaged app (`/Applications/AI Center Planner.app`) uses the real vault.
2. **Vault edits are line-local.** Re-parse the file, find the target by stable id, change only that line (`electron/main/vault/edits.ts`). Never re-serialize a whole vault file the app doesn't own. Obsidian, Claude, Codex and a meeting-review task edit the same files concurrently.
3. **Files the app owns** (it may rewrite them whole): `05_Tasks/weekly/YYYY-Www.md` and `05_Tasks/planner/preferences.md` (frontmatter only; the body is kept).
4. **Google Calendar:** only events tagged `extendedProperties.private.aiCenterPlanner` may be changed or deleted (`GoogleCalendar.assertOwned`). Never touch the user's or Codex's events. Sync happens only after the user confirms the diff dialog.
5. **Git commits never mention Claude**: no `Co-Authored-By: Claude`, no "Claude" in messages. This applies to commits in this repo, in the vault, and to commits the app makes (`planner: …`, user's identity). The user asked for this explicitly.
6. **Commit or push only when the user asks.** This repo isn't a git repo yet.
7. **Don't change models or effort levels** in `electron/main/context/agent.ts` (`CONTEXT_MODELS`) without the user asking. They chose them for cost.
8. The vault's own rules apply to any vault content change: `03_Workflows/assistant-file-update-rules.md` and `03_Workflows/context-maintenance.md`.

## Where AI is used (and where it is not)

- **AI:** only the "Update context" button (⌘U). It runs `codex exec` (default: `gpt-5.6-terra`, medium) or `claude -p` (`claude-sonnet-5`, medium, tools limited to Read/Edit/Write/Glob/Grep) inside the vault. Text files are snapshotted before the run. The user sees a per-file diff, then **Keep** (one commit) or **Undo** (exact restore). Cancel, error or quit undoes everything.
- **Not AI:** planning, re-planning, training placement, parsing, sync diff, logging, budgets. All of these are deterministic code in `electron/main/scheduler/plan.ts` and friends.

## Architecture

```
electron/main/
  index.ts              windows, global shortcut ⌘⇧Space (quick capture), IPC dispatch
  controller.ts         implements the Api (shared/api.ts); owns vault, calendar, plan, context runs
  settings.ts           userData/settings.json (vault path, autoCommit, OAuth client, contextEngine)
  vault/                parser.ts (tasks/inbox), tokens.ts (~2h, due:, by 31/10, !high), edits.ts (line patches),
                        service.ts (read/write/watch), git.ts (batched commits), preferences.ts, training.ts, weekly.ts
  scheduler/plan.ts     pure planner, see README "Planning rules"
  calendar/google.ts    OAuth loopback, events, tagged writes;  calendar/sync.ts  pure diff
  context/agent.ts      Update-context runner (Codex / Claude Code CLIs)
electron/preload/       exposes window.api.call / onState / onProgress
shared/                 types.ts, api.ts (renderer↔main contract), time.ts (local-time helpers)
src/                    React 19 + Tailwind 4 + zustand. views/ (Today, Week, Tasks, Inbox, Docs, Review, Settings, Capture), components/
tests/                  vitest: vault.test.ts, scheduler.test.ts, sync.test.ts (fixtures = copies of real vault files, gitignored)
```

Data flow: the main process computes `AppState` (vault + calendar + plan) and pushes it on every change (`state` channel). The renderer calls `api.<method>()` and never touches files.

## Conventions

- TypeScript strict; match the existing style (no semicolons, single quotes, 2 spaces, terse comments explaining *why*).
- Times are local. Planner timestamps are `YYYY-MM-DDTHH:mm:00` without an offset (`localISO`). Google returns offsets; compare via `Date`.
- New renderer→main calls: add the method to `shared/api.ts` and implement it on `Controller`. The preload proxy needs no change.
- Custom UI pieces only (no shadcn/FullCalendar): `components/TimeGrid.tsx` is our own grid, `components/ui.tsx` holds the primitives. Docs editing uses Milkdown Crepe (`components/DocEditor.tsx`).

## Verify your changes

```bash
npm test              # 34 tests; must stay green
npm run typecheck
npm run build && npx electron . --remote-debugging-port=9333 &   # dev vault
node scripts/cdp.mjs /tmp/shot.png "document.body.innerText.slice(0,300)"   # screenshot + eval in the renderer
cd .dev-vault && git status && git log --oneline | head   # confirm what the app wrote
npm run install-app   # package + copy to /Applications (uses the REAL vault at runtime)
```

macOS `screencapture` is blocked in agent sandboxes. Use `scripts/cdp.mjs`. Call the main process from the renderer with `window.api.call('<method>', ...args)`.

## Status (2026-11-08)

Done and verified: vault parsing/editing, scheduler, Today/Week/Tasks/Inbox/Docs/Review/Settings, time logging, pins/drag, git commits, packaging, Update context (Codex and Claude live-tested on the dev vault).
Not yet verified live: Google OAuth + sync (needs the user's Google Cloud OAuth client). The real vault has only the baseline commit; no app writes yet.
Next: see `ROADMAP.md` (Braindump feature is pending the user's spec).
