# AI Center Planner

Motion-style routine organizer on top of the AI Center vault (`~/Documents/Personal Vault/AI Center`) and your calendars (macOS Calendar, or Google directly). It's a macOS desktop app (Electron): open it from `/Applications`; quitting it leaves nothing running.

For AI assistants and handoff: read `AGENTS.md` (rules, architecture, how to verify), then `ROADMAP.md`.

## Features

| Screen | What it does |
|---|---|
| **Brief** | Morning overview: day ribbon, planned hours per area, training, deadlines, task notes, warnings. On the first open of each day the app prepares an AI brief (Claude Haiku, read-only: vault, Gmail, calendar) with emails/attention, priorities, AI preparation ideas and TEMPORARY INBOX suggestions you add with one click. **Run daily brief** re-runs it anytime; the prompt is editable in Settings (stored in `06_Prompts/daily-brief.md`). Saved to `05_Tasks/briefs/YYYY-MM-DD.md`. |
| **Today** | Timeline of today's plan. Drag tasks onto empty time (new block) or onto a block (adds it there); drag blocks to move them; click a block to log time, add/remove tasks, or remove the block (Delete key, with Undo). **Calendars** menu: show/hide calendars and set each to Busy (planner works around it) or Free (may plan over it); single events can be overridden too. |
| **Week** | Week grid with the same drag/drop and block editing as Today, budget bars (actual vs planned vs target/cap), warnings, **Re-plan**, **Calendars** menu, **Sync to calendar** (shows every change for approval). |
| **Tasks** | `05_Tasks/daily-todos.md` as a structured list: inline edit, estimate / deadline / priority chips, quick add. |
| **Inbox** | Raw ideas in `05_Tasks/braindump-inbox.md`; turn them into tasks. ⌘⇧Space captures from anywhere while the app is open. |
| **Docs** | WYSIWYG editor for context, profile, projects and priorities. Markdown stays the storage. |
| **Review** | Planned vs actual per category, logged blocks, slipped tasks, priorities editor. |
| **Update context** (⌘U) | Type what changed; Codex/Claude edits the vault; review the diff; Keep or Undo. (AI is used only here and in the Brief.) |
| **Settings** | Vault and auto-commit, AI engine for Update context, Calendar (macOS or Google), Daily brief (auto-run, email, prompt editor), Todo headings → areas, Areas (colour, calendar, container events), Scheduling strategy (weights, timing, weekly hours grid), Planning rules (caps, gaps, breaks), Working hours, Training. |

Task lines can carry optional metadata: `~2h` / `~45m` estimate, `due:2026-11-12` or `by 12/11` deadline, `!high` / `!low` priority, `@spread` / `@asap` timing.

## Planning rules (deterministic, no AI)

Code: `electron/main/scheduler/plan.ts` (pure function, unit-tested). Every number below is editable in **Settings → Planning rules / Categories**, stored in `05_Tasks/planner/preferences.md`.

### When the plan changes
- **The plan stays put during the day.** Adding, editing or finishing tasks, logging time and calendar refreshes only change *what sits inside* existing blocks. New work goes into gaps. Blocks never move.
- **Full re-plan** happens (a) each morning (the planning day rolls over at 04:00), (b) when you change preferences, (c) when you click **Re-plan**.
- A block **already started** never moves, even on a full re-plan. **Pinned** blocks (dragged or logged) never move.
- If a new calendar event collides with a block, only that block is re-placed, with a "conflict" warning.
- A new block that ends up empty disappears (its gap opens up). Unused tails of a block are trimmed.

### What gets planned first (Settings → Scheduling strategy)
1. **Guarded deadlines**: tasks due within 2 days (or recently overdue), earliest first. They may go past the grid hours.
2. Everything else by **weighted score** = (deadline weight 2 × urgency + priority weight 1 × priority) × area weight (Thesis 1.5, Courses 1.2, Outside 1, Personal 0.8). Urgency = 1 / (1 + days until due); priority high 1, medium 0.5, low 0.
3. Last: **stale** tasks (overdue > 14 days), flagged "reschedule or drop it?".
Ties are broken by order in the file. Only leaf tasks are planned (parents wait for their subtasks).

### Timing
- **As soon as possible** (default): earliest free day first.
- **Spread**: evenly over the working days until deadline − slack (or over 5 days if undated); leftovers fall back to ASAP. Set per area, or per task with the ⇄ button (writes `@spread` / `@asap` on the line).

### Weekly hours grid
Hours per area per weekday (default: Thesis 4/2/4/2/4/2/–, Courses 2/3/1/3/1/–/–, Outside 1/1/2/1/2/1/–, Personal 0.5 weekdays, 1 at weekends). An area never gets more than its hours that day, except for guarded deadlines. Areas marked **reserve** (Thesis) keep their hours as blocks even without concrete tasks. Training is outside the grid.

### Areas and headings
Settings → **Todo headings → areas** lists every heading of `daily-todos.md`: click a colour to assign it, and sub-headings inherit from their parent. Container events are picked from the titles actually in the area's calendar.
Duration = `~` estimate or the category default (Thesis 90m, Courses 60m, Outside 30m, Personal 15m).

### Shape of a day
| Rule | Default |
|---|---|
| Working hours | Mon–Fri 08–21, Sat–Sun 09–19 |
| Max planned work per day (training and breaks don't count) | 8 h weekdays, 4 h weekends |
| Max deep work (Thesis + Courses) per day | 6 h |
| Max time on one task per day (big tasks spread over days) | 3 h |
| Longest block | 3 h |
| Gaps | 30 min after deep work and around training, 15 min otherwise |
| Protected floating breaks | Lunch 60 min within 12–14, Dinner 45 min within 19–21 |
| Finish deadline tasks early | 1 day (warning if slack is lost) |

### Where each category goes
| Category | Tried first (preferred) | Allowed (hard window) | Shortest new block |
|---|---|---|---|
| Thesis | 08:00–12:30 | 08:00–19:00 | 60 min |
| Courses | 13:30–17:30 | 08:00–20:00 | 45 min |
| Outside work | 14:00–19:00 | 08:00–21:00 | 30 min |
| Personal | 17:00–20:00 | 09:00–20:00 | 30 min (small tasks batch into one block) |

### Placement order for each day, per task
1. Your existing calendar blocks with matching titles ("Thesis Deep Work", "Outside Work", "Course Consolidation").
2. Free room in blocks already planned for that category.
3. Growing a planned block (end only, up to 3 h).
4. A new block in the preferred window, then anywhere in the hard window.
The next day is tried only after all of that fails, subject to the daily, deep-work, per-task and weekly caps (Outside work ≤ 12 h/week).

### Training and budgets
- Training: session from the 7-day cycle in `hybrid-training.md` (Day 1 = 2026-11-02; Day 7 rotates threshold → long Z2 → rest). It labels that day's Sports event, or takes the first free slot in 18–21, then 07–09. Placed before breaks, so dinner moves around it.
- Weekly minimums: Thesis gets reserved blocks until 18 h/week (logged + planned) is reached.
- Warnings: overdue, deadline at risk or losing slack, stale, doesn't fit in 14 days, budget behind/over, calendar conflict, no training slot.

**Calendar connection:** macOS Calendar by default (EventKit via the bundled `native/calendar-helper`; your Google calendars come through System Settings → Internet Accounts; no Cloud project). Google Calendar API directly is the alternative (Settings → Calendar). Planner events are tagged (macOS: `[planner:<id>]` in the notes; Google: a hidden property); untagged events are never changed. Protected calendars (Birthdays, ETH Classes…, ETH Tests, Family) are never written.

**Your calendar edits win:** move or resize a planner event in your calendar and it becomes a pin at the new time; delete it and it isn't recreated (its work is planned elsewhere; a deleted training session isn't replaced that day).

**Sync** (button, Week view): covers today + 7 days. It writes blocks to the category's calendar (Thesis/Courses/Outside → Study Schedule, Training → Sports, Personal → Personal), only touches events the planner created (hidden tag), and shows every add, move and remove for confirmation first. Container events and breaks are never written.

## Safety

- Vault edits change only the affected lines, re-located by task id on the current file, so concurrent edits elsewhere survive.
- Every save is committed to the vault's git history under your identity (`planner: …`), batched every few seconds; this can be turned off.
- Docs refuse to save over a file changed on disk since opening and show a diff before reformatting untouched Markdown.
- Update context never keeps anything without **Keep**; Undo restores files byte-for-byte.

## Develop

```bash
npm install
npm run dev          # hot-reload, against .dev-vault (scratch copy), never the real vault
npm test             # parser, scheduler, sync-diff, brief-prompt tests
npm run typecheck
npm run build:helper # compile the macOS Calendar helper (Swift; also part of package)
npm run install-app  # build, package, copy to /Applications (runtime uses the real vault; restart the app)
```

Stack: Electron 45, electron-vite, React 19, Tailwind 4, zustand, Milkdown Crepe, googleapis, chokidar, vitest.
