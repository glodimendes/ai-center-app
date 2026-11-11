# AI Center

Motion-style routine organizer on top of the AI Center vault (`~/Documents/Personal Vault/AI Center`) and your calendars (macOS Calendar, or Google directly). It's a macOS desktop app (Electron): open it from `/Applications`; quitting it leaves nothing running.

For AI assistants and handoff: read `AGENTS.md` (rules, architecture, how to verify), then `ROADMAP.md`.

## Features

| Screen | What it does |
|---|---|
| **Brief** | Morning overview: day ribbon, planned hours per area, training, deadlines, task notes, warnings. On the first open of each day the app prepares an AI brief (Claude Haiku, read-only: vault, Gmail, and today's events from the calendars shown in the app only) with emails/attention, priorities, AI preparation ideas and TEMPORARY INBOX suggestions you add with one click. **Run daily brief** re-runs it anytime; the prompt is editable in Settings (stored in `06_Prompts/daily-brief.md`). Saved to `05_Tasks/briefs/YYYY-MM-DD.md`. |
| **Today** | Task list with search, sort (planned time, deadline, priority, area, shortest first, file order), a Show filter (planned, not planned, overdue, with deadline, no estimate, high or urgent priority, repeating, postponed, with alerts) and area chips, remembered on this Mac. Timeline of today's plan (00:00–24:00). **Add a block** by dragging on empty time or with **+ Block** (area, title, day, from–to; it stays where you put it and, unless you untick it, the planner fills it with that area's tasks; with **No area** it just holds the time, e.g. an appointment: never filled, not counted as work, synced to the Other area's calendar). Drag tasks onto empty time (new block) or onto a block (adds it there); drag blocks to move them, or their bottom edge to change the duration (also hh:mm in the block panel); click a block to log time (checking a task there saves at once: the task is marked done and, once the block has started, the log is written), add/remove tasks, or remove the block (Delete key, with Undo; its time stays free until Re-plan). **Your calendar events** can be edited by hand: click one to change its title, day or time, or delete it (asks first), or drag it / its bottom edge on the grid (with Undo). Only that occurrence changes; protected and read-only calendars stay locked, and nothing automatic ever edits them. **Calendars** menu: show/hide calendars and set each to Busy (planner works around it) or Free (may plan over it); single events can be overridden too. **Wrap up** (end of the day, Sunsama-style): log today's unlogged blocks in one click each (done / partial / skipped, minutes prefilled), mark leftovers done or push them 2 days / a week, and preview tomorrow. **Sync day** pushes only the day you are looking at, through the same approval dialog as the week's Sync; blocks on every other day are left untouched. **Repeating tasks** are scoped to the day here too: the trash on a repeating task skips *this* occurrence (its `due:` moves to the next one, with Undo) and leaves the series alone — delete the whole thing from the Tasks view. |
| **Week** | Week grid with the same drag/drop, block drawing (+ Block) and block editing as Today, budget bars (actual vs planned vs target/cap), day-rule labels under each date (e.g. "Lighter half-day"), a link to Alerts, **Re-plan** (options below), **Calendars** menu, **Sync to calendar** (the whole sync window, `syncDays` ahead; shows every change for approval — use Today's **Sync day** for a single day). |
| **Alerts** | Every planner warning as a worklist: one row per task with all its problems, grouped by the most serious (overdue, won't make the deadline, stale, doesn't fit, budgets, calendar conflicts, training), with fixes inline (move or remove the deadline, estimate, priority, mark done, show in plan). Filter by area. |
| **Tasks** | `05_Tasks/daily-todos.md` as a structured list: inline edit, estimate / deadline / priority chips, quick add. Subtasks: hover a task to add a subtask, nest it under the task above, or move it out (Tab / ⇧Tab while editing a title); its own subtasks move with it. **Drag a task onto another** (same parent, same section) to reorder it there — also changes planning order for same-score ties (see "What gets planned first"). This is where a task is deleted outright, repeating ones included — Today only skips one occurrence. **Suggest estimates** (when tasks lack a `~` estimate): Claude Haiku, with no access to anything, proposes a length for each from its title, area and your own estimates; you untick or edit, then apply (one-line edits). Each heading shows its **projected finish** from the current plan (→ Fri) and how many tasks would finish after their deadline or aren't planned; a task's row shows its first block and, if later, the day it finishes. |
| **Inbox** | **New in your todo list**: tasks that appeared in `daily-todos.md` from outside the app (the meeting-review automation, Codex, an Obsidian edit; a renamed task too) wait here until you keep or delete each; the sidebar count includes them. Raw ideas in `05_Tasks/braindump-inbox.md`; turn them into tasks. ⌘⇧Space captures from anywhere while the app is open. |
| **Docs** | WYSIWYG editor for context, profile, projects and priorities. Markdown stays the storage. |
| **Review** | Planned vs actual per category, logged blocks, slipped tasks, priorities editor. **Review & plan the week** walks through the weekly review: how last week went, archive checked tasks (to `05_Tasks/archive/done-YYYY.md`, under their heading), the week's focus, this week's own hours per area (Settings' grid otherwise) and day-rule picks, then Re-plan and Sync. |
| **Update context** (⌘U) | Type what changed; Codex/Claude edits the vault; review the diff; Keep or Undo. (AI is used only here and in the Brief.) |
| **Settings** | Vault and auto-commit, AI engine for Update context, Calendar (macOS or Google), Daily brief (auto-run, email, prompt editor), Todo headings → areas, Areas (add/remove; colour, calendar, container events, allowed and preferred windows; "keep tasks whole"; Training is an area like the others, plus a gap around it), Scheduling strategy (weights, timing, weekly hours grid), Planning rules (caps, gaps, breaks, as hh:mm), Working hours. |

Task lines can carry optional metadata: `~2h` / `~45m` estimate, `due:2026-11-12` or `by 12/11` deadline, `!urgent` / `!high` / `!low` priority (the flag chip cycles low → medium → high → urgent), `@spread` / `@asap` timing, `repeat:weekly` repetition (also `daily`, `weekdays`, `biweekly`, `monthly`, `yearly`, custom `3d` / `2w` / `6m` / `1y`, weekdays like `mon,thu`, or every N weeks on weekdays like `3w:sun`; set it with the 🔁 chip), `postpone:2026-11-20` (the 🌙 chip: not planned before that date), `3x/week` habit (set it in the 🔁 chip: that many sessions a week on different days, spread over the days left; checking it off logs one session and keeps the line open; the chip shows e.g. 1/3 for this week).

**Checking off a task** (the circle in any task list):
- A **repeating** task stays checked, and its next occurrence is added right above it with the next due date (counted from the old due date, always after today). The open task keeps its place in the plan.
- If it wasn't in a block running right now, a **15-min block ending now** ("✓ title") is logged and pinned, and synced to the calendar like any planner block. The length is in Settings → Planning rules; 0 turns it off. Reopening the task removes that block.

## Planning rules (deterministic, no AI)

Code: `electron/main/scheduler/plan.ts` (pure function, unit-tested). Every number below is editable in **Settings → Planning rules / Categories**, stored in `05_Tasks/planner/preferences.md`.

### When the plan changes
- **The plan stays put during the day.** Adding, editing or finishing tasks, logging time and calendar refreshes only change *what sits inside* existing blocks. New work goes into gaps. Blocks never move.
- **Full re-plan** happens (a) each morning (the planning day rolls over at 04:00), (b) when you change preferences, (c) when you click **Re-plan**.
- **Plan with a wish** (top of the Re-plan dialog): type a sentence ("keep Friday afternoon free, thesis 6 h on Monday"); Claude Haiku, seeing only that sentence, the next 14 dates (today and tomorrow named, with working hours), your areas, todo headings and hours, turns it into date limits, hours for specific days (that week's grid), **focus time for a heading** ("tomorrow morning on Tamanduá" → a block pinned in the free part of that span, holding only that heading's open tasks, most urgent first) and optionally a strategy. You see the changes and the resulting plan before anything is saved; applied wishes are listed there and can be removed.
- **Re-plan options**: Re-plan shows four strategies side by side, each with a mini week and metrics for the next 7 days (work, deep work, after 19:00, free working time, task switches, deadline warnings, doesn't fit). **Balanced** = your settings; **Deadlines first** = deadline weight ×3, guard +2 days, all ASAP; **Deep work first** = deep-work areas +25% grid hours, ×1.5 weight, +1 h deep-work cap, other areas −25% hours, ×0.8 weight; **Light week** = daily caps, deep-work cap, grid hours and weekly targets −25%, no reserved blocks. **Shuffle** = a different arrangement under the same strategy (score ±15%, seeded tie-breaks). The applied strategy stays for later re-plans until you pick another.
- A block **already started** never moves, even on a full re-plan. **Pinned** blocks (dragged or logged) never move.
- If a new calendar event collides with a block, only that block is re-placed, with a "conflict" warning.
- A **removed block's time stays free** (shown as "Kept free") until you click **Re-plan** or "Let the planner use it", so you can put something else there first. Its tasks are planned elsewhere. The same applies to a planner event you delete in your calendar.
- **Resizing** a block (drag its bottom edge, or the hh:mm field in its panel) pins it at the new length.
- A new block that ends up empty disappears (its gap opens up). Unused tails of a block are trimmed.

### What gets planned first (Settings → Scheduling strategy)
1. **Guarded deadlines**: tasks due within 2 days (or recently overdue), earliest first. They may go past the grid hours.
2. Everything else by **weighted score** = (deadline weight 2 × urgency + priority weight 1 × priority) × area weight (Thesis 1.5, Courses 1.2, Outside 1, Personal 0.8). Urgency = 1 / (1 + days until due); priority urgent 2, high 1, medium 0.5, low 0.
3. Last: **stale** tasks (overdue > 14 days), flagged "reschedule or drop it?".
Ties are broken by order in the file. Only leaf tasks are planned (parents wait for their subtasks).

### Timing
- **As soon as possible** (default): earliest free day first.
- **Spread**: evenly over the working days until deadline − slack (or over 5 days if undated); leftovers fall back to ASAP. Set per area, or per task with the ⇄ button (writes `@spread` / `@asap` on the line).

### Weekly hours grid
Hours per area per weekday (default: Thesis 4/2/4/2/4/2/–, Courses 2/3/1/3/1/–/–, Outside 1/1/2/1/2/1/–, Personal 0.5 weekdays, 1 at weekends). An area never gets more than its hours that day, except for guarded deadlines. **A 0 sets nothing aside rather than forbidding the area:** once every area with hours that day is planned, tasks still left over (any area, plus Other, which has no row) may use the remaining time on days where their area has 0 hours, ranked by the usual score. Areas marked **reserve** (Thesis) keep their hours as blocks even without concrete tasks. Reserved hours are placed right after training, breaks and deadlines due within the guard window, before other areas' tasks, so they get their preferred windows; the area's own tasks then fill them. **Weights only decide which tasks go first; the grid decides how many hours an area gets.** Training is outside the grid.

### Areas and headings
Settings → **Todo headings → areas** lists every heading of `daily-todos.md`: click a colour to assign it, and sub-headings inherit from their parent. Container events are picked from the titles actually in the area's calendar.
Duration = `~` estimate or the category default (Thesis 90m, Courses 60m, Outside 30m, Personal 15m).

### Day rules (Settings → Day rules)
Rules for some days, so a routine change is a setting: **Every** chosen weekday, or **One day a week, the lightest of** some weekdays (the one with the least calendar time; pick another per week in the weekly review). Each rule either keeps areas out of part of the day (**No** work / chosen areas, from–to; e.g. no work after 13:00) or caps them (**At most** 2 h of Outside work). They apply to time the planner adds; your calendar events, pins and already-placed blocks stay. A sample "Lighter half-day" rule ships switched off.

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
| Finish deadline tasks early (spread tasks aim for it) | 1 day |

### Where each category goes
Each area can have several preferred windows, tried in order, then its allowed window. Defaults:

| Category | Tried first (preferred) | Allowed (hard window) | Shortest new block |
|---|---|---|---|
| Thesis | 08:00–12:30 | 08:00–19:00 | 60 min |
| Courses | 13:30–17:30 | 08:00–20:00 | 45 min |
| Outside work | 14:00–19:00 | 08:00–21:00 | 30 min |
| Personal | 17:00–20:00 | 09:00–20:00 | 30 min (small tasks batch into one block) |
| Training | 18:00–21:00, then 07:00–09:00 | 07:00–21:30 | 30 min |

### Placement order for each day, per task
1. Your existing calendar blocks with matching titles ("Thesis Deep Work", "Outside Work", "Course Consolidation").
2. Free room in blocks already planned for that category.
3. Growing a planned block (end only, up to 3 h).
4. A new block in each preferred window in turn, then anywhere in the hard window.
The next day is tried only after all of that fails, subject to the daily, deep-work, per-task and weekly caps (Outside work ≤ 12 h/week).

### Training and budgets
- Training is an ordinary area: its tasks (under the headings mapped to Training, typically with a `repeat:` rule) get the same scoring, windows, grid hours, warnings and Re-plan options as everything else. It fills your Sports events ("Sport", "Running") like any container, and a new single-session block is named after the session. Differences: it's placed before breaks (dinner floats around it), a session is never split ("Keep tasks whole" in Settings → Areas, on for Training), a gap around it, and it doesn't count toward (or use up) the daily work cap.
- Repeating tasks are planned by their rule: weekday rules (`repeat:mon`, `repeat:3w:sun`) **on** their due day; interval rules (`repeat:weekly`, `repeat:3d`) anywhere in the period ending on the due date.
- **Postponed** tasks (`postpone:2026-11-20`, the 🌙 chip) aren't planned before that date; from then on they're ranked as usual.
- **Habits** (`3x/week`) become that many sessions per week, minus sessions already logged this week: each due at the end of its week, not before its slot (spread over the days left), one per day, each kept whole. Weeks cut off by the 14-day horizon only get the sessions inside it.
- Weekly minimums: Thesis gets reserved blocks until 18 h/week (logged + planned) is reached.
- Warnings: overdue, deadline at risk, stale, doesn't fit in 14 days, budget behind/over, calendar conflict.

**Calendar connection:** macOS Calendar by default (EventKit via the bundled `native/calendar-helper`; your Google calendars come through System Settings → Internet Accounts; no Cloud project). Google Calendar API directly is the alternative (Settings → Calendar). Planner events are tagged (macOS: `[planner:<id>]` in the notes; Google: a hidden property); untagged events are never changed. Protected calendars (Birthdays, ETH Classes…, ETH Tests, Family) are never written.

**Your calendar edits win:** move or resize a planner event in your calendar and it becomes a pin at the new time; delete it and it isn't recreated (its time stays free until Re-plan; its work is planned elsewhere).

**Sync** (button, Week view): covers today + 7 days. It writes blocks to the category's calendar (Thesis/Courses/Outside → Study Schedule, Training → Sports, Personal → Personal), only touches events the planner created (hidden tag), and shows every add, move and remove for confirmation first. Container events and breaks are never written.

## Safety

- Vault edits change only the affected lines, re-located by task id on the current file, so concurrent edits elsewhere survive.
- Every save is committed to the vault's git history under your identity (`planner: …`), batched every few seconds; this can be turned off.
- Docs refuse to save over a file changed on disk since opening and show a diff before reformatting untouched Markdown.
- Update context never keeps anything without **Keep**. Undo takes back only the AI's own edits, so changes you (or the app) made to the same files since are kept; if a file can't be separated cleanly it's left alone and named.
- A calendar account that's offline or missing doesn't count as "you deleted those events": synced blocks are only dismissed when their calendar actually loaded.

## Develop

```bash
npm install
npm run dev          # hot-reload, against .dev-vault (scratch copy), never the real vault
npm test             # parser, edits, scheduler (rules, habits, wishes), sync/adoption, brief, context-undo tests
npm run typecheck
npm run build:helper # compile the macOS Calendar helper (Swift; also part of package)
npm run build:icon   # redraw the app icon (scripts/make-icon.swift → build/icon.icns)
npm run install-app  # build, package, copy to /Applications (runtime uses the real vault; restart the app)
```

Stack: Electron 45, electron-vite, React 19, Tailwind 4, zustand, Milkdown Crepe, googleapis, chokidar, vitest.
