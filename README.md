# AI Center Planner

Motion-style routine organizer on top of the AI Center vault (`~/Documents/Personal Vault/AI Center`) and Google Calendar. It's a macOS desktop app (Electron): open it from `/Applications`; quitting it leaves nothing running.

For AI assistants and handoff: read `AGENTS.md` (rules, architecture, how to verify), then `ROADMAP.md`.

## Features

| Screen | What it does |
|---|---|
| **Today** | Timeline of today's plan. Drag tasks onto it, drag blocks to move them, click a block to log actual time. |
| **Week** | Week grid, budget bars (actual vs planned vs target/cap), warnings, **Sync to calendar**. |
| **Tasks** | `05_Tasks/daily-todos.md` as a structured list: inline edit, estimate / deadline / priority chips, quick add. |
| **Inbox** | Raw ideas in `05_Tasks/braindump-inbox.md`; turn them into tasks. ⌘⇧Space captures from anywhere while the app is open. |
| **Docs** | WYSIWYG editor for context, profile, projects and priorities. Markdown stays the storage. |
| **Review** | Planned vs actual per category, logged blocks, slipped tasks, priorities editor. |
| **Update context** (⌘U) | Type what changed; Codex/Claude edits the vault; review the diff; Keep or Undo. **The only AI feature.** |
| **Settings** | Vault path, auto-commit, Google Calendar, AI engine, categories, working hours, training. |

Task lines can carry optional metadata: `~2h` / `~45m` estimate, `due:2026-11-12` or `by 12/11` deadline, `!high` / `!low` priority.

## Planning rules (deterministic, no AI)

Code: `electron/main/scheduler/plan.ts` (pure function, unit-tested). Settings: `05_Tasks/planner/preferences.md` (built-in defaults until you create it).

**Inputs.** Open tasks; all calendar events in the next 14 days; preferences; the training plan; weekly logs (pins and logged time).

**Task basics**
- Category = the deepest todo heading that matches a category's `headings` (e.g. `ETH › Thesis` → Thesis). Unmatched → Other.
- Duration = `~` estimate, else the category default (Thesis 90m, Courses 60m, Outside work 30m, Personal 15m), rounded up to 15 min.
- Only leaf tasks are scheduled (a parent waits until its subtasks are done). Done tasks are ignored.
- Order: earliest deadline → priority (high, medium, low) → position in the file. Overdue tasks therefore come first.

**Time**
- Free time = working hours (Mon–Fri 08–21, Sat–Sun 09–19) minus every timed event in every calendar (except holiday calendars; all-day events never block) minus pinned blocks, with a 15-min buffer around busy time. Nothing is planned in the past.
- Each category may have a time window (Thesis 08–19, Courses 08–20, Personal 09–20).

**Placement order**
1. **Pins** (blocks you dragged or logged) are fixed.
2. **Training:** the session comes from the 7-day cycle in `hybrid-training.md` (cycle start 2026-11-02 = Day 1; Day 7 rotates threshold → long Z2 → rest). If a Sports event exists that day, it's labelled with the session. Otherwise it goes into the first free slot in 18:00–21:00, then 07:00–09:00.
3. **Containers first:** events whose title matches a category (e.g. "Thesis Deep Work" in Study Schedule, "Outside Work", "Course Consolidation") are filled with that category's tasks. Tasks are split across blocks if needed; chunks are ≥ 30 min unless the task is shorter.
4. **New blocks:** leftover work goes into free time inside the category window. An existing new block of the same category grows up to 3 h before another starts. Limits: max 6 h of deep work (Thesis + Courses) per day, and weekly caps (Outside work ≤ 12 h; overflow moves to next week).
5. **Weekly minimums:** if Thesis has < 18 h (logged + planned) this week, reserved "Thesis Deep Work" blocks are added.
6. **Warnings:** overdue, won't finish before deadline, doesn't fit in 14 days, budget behind or over cap, no slot for training.

**Re-planning** runs automatically when any vault `.md` file changes (also from Obsidian, Claude or Codex), when the calendar refreshes (every 10 min while open, and on window focus), when you log time, and when you drag or pin. Anything not pinned may move. Unfinished work carries forward automatically because the task's remaining estimate is what gets scheduled; when logging a block you can tick tasks done or enter "still needs".

**Sync** (button, Week view): covers today + 7 days. It writes blocks to the category's calendar (Thesis/Courses/Outside → Study Schedule, Training → Sports, Personal → Personal), only touches events the planner created (hidden tag), and shows every add, move and remove for confirmation first. Container events are never modified.

## Safety

- Vault edits change only the affected lines, re-located by task id on the current file, so concurrent edits elsewhere survive.
- Every save is committed to the vault's git history under your identity (`planner: …`), batched every few seconds; this can be turned off.
- Docs refuse to save over a file changed on disk since opening and show a diff before reformatting untouched Markdown.
- Update context never keeps anything without **Keep**; Undo restores files byte-for-byte.

## Develop

```bash
npm install
npm run dev          # hot-reload, against .dev-vault (scratch copy), never the real vault
npm test             # parser, scheduler, sync-diff tests
npm run typecheck
npm run install-app  # build, package, copy to /Applications (runtime uses the real vault)
```

Stack: Electron 45, electron-vite, React 19, Tailwind 4, zustand, Milkdown Crepe, googleapis, chokidar, vitest.
