# Roadmap

Approved original plan: `~/.claude/plans/cryptic-baking-prism.md` (with addendum). Everything here reflects 2026-11-11.

## Open decisions (waiting for the user)

1. **Calendar ownership.** Today the user's weekly Codex automation (`~/.codex/automations/plan-next-eth-week`) proposes the week in chat and, after approval, creates blocks (thesis 18–22 h, outside work 12 h, six sport sessions, one lighter half-day). The user edits blocks afterwards. Options:
   1. **App owns the blocks** from the weekly grid; Sync is the approval; Codex stops creating blocks. This is the recommended option.
   2. App proposes, Codex applies.
   3. Codex owns the blocks, the app only fills them.
   4. Split by area.
   5. Mixed (current behaviour).
   6. No blocks: the plan lives only in the app.

   Edit adoption ("calendar edits win") is built and works with all of them. **Don't change container behaviour until the user decides.** Since 2026-11-09 the app also plans training sessions itself (TRAINING tasks), so the Codex automation's "six sport sessions" would duplicate them; raise this with the user.
2. **Plan options.** Built (2026-11-09): four strategies + Shuffle (README "When the plan changes"). Not built: the optional **"Plan with a wish"** box (Haiku turns a sentence into temporary planner settings). Waiting for the user.
3. **Braindump feature.** The user will explain it. **Don't design or build it before the spec.** It's related to the Inbox view and ⌘⇧Space capture, which write to `05_Tasks/braindump-inbox.md` under `## YYYY-MM-DD` headings (`parseInbox` / `addInboxItem`).

## Later (agreed with the user, not now)

- **Skeleton-then-fill placement, with a front-loading option.** Today's order grew from patches: pins → training → breaks → deadlines within the guard → reserved grid hours → other tasks by score (each grabs the first free slot in its area's windows, i.e. front-loading). Proposed redesign (2026-11-09): lay down each area's grid hours first, areas in area-weight order (higher weight wins contested windows), then fill those blocks with tasks by score; unfilled blocks are dropped except for "reserve" areas. Keep the current front-loading behaviour as an option. Rewrites the middle of `scheduler/plan.ts`; most placement tests need review; blocks move once on the first full re-plan.

## Next (agreed or obvious)

- **Finish verifying Sync live with the user.** Done 2026-11-08: dry run, one block synced, move → pin. Still to do: delete a moved block in Calendar.app and check it disappears (bug fixed since), and confirm untagged events (the user's own, Codex's) stay untouched after a full Sync.
- **Verify single-day sync live** (installed, never run against the real calendar; pushed anyway on 2026-11-11 at the user's go-ahead). Today → **Sync day**. The one thing to watch: syncing a single day must leave planner events on *other* days untouched, including ones that are out of date — the day-scoped diff deliberately does not clean them up. Worth pairing with the full-Sync check above, since both need the installed app.
- **Watch the repeating-task skip live** (installed 2026-11-11). Today's trash on an open repeating task should move its `due:` on and keep the series; the Tasks view should still delete the whole thing. Verified in the dev vault only.
- **Lighter half-day rule.** The user's planning routine asks for one per week; the planner has no such rule yet (e.g. "no work after 13:00 on a chosen day").
- **The user's Codex `daily-brief` automation** still runs alongside the in-app brief and points to the non-existent path `/Users/glodimendes/Personal Vault/AI Center`. Suggest the user turn it off (they manage it in the Codex app; don't edit `~/.codex`). The vault's `03_Workflows/daily-brief.md` has the same wrong path and should be fixed via Update context or with the user's OK.

## Known limitations

- **Removals:** removing a block (or pressing Delete) asks no confirmation. There's an Undo in the toast; after that, only by editing `overrides.dismissed` in the weekly file.
- **Overrides** (assignments, exclusions, dismissals) stay in the weekly files permanently.
- **Blocks that don't take new tasks:** logged or past blocks.
- **Brief ribbon:** "In meetings / classes" counts events that are free only by a per-event override or the calendar's own free flag.
- **Duplicate blocks:** new blocks may be created next to Codex-made ones for areas without matching containers. That goes away if the user picks ownership option 1.
- **Packaging:** the app is signed with a local self-signed certificate (`scripts/sign-app.sh`, identity "AI Center Dev"), not an Apple Developer ID, so first launch may still need right-click → Open. `install-app` packages, signs, then replaces the bundle (and removes the old "AI Center Planner.app"); the user must restart the app. The certificate exists to keep the Calendar permission across rebuilds — an ad-hoc bundle's code hash changes every build, so macOS asked for access again each time.
- **Vault auto-commits take whole files:** a manual edit to a file the app later writes (e.g. `daily-todos.md`) is included in the app's next `planner: …` commit.
- **Kept-free slots** are released only by Re-plan or "Let the planner use it"; the morning re-plan keeps them.
- **Re-plan options can look alike:** when the weekly hours grid is what limits each area (the usual case), strategies mostly reorder tasks inside the same blocks; the dialog says "same plan as Balanced right now" when nothing differs.
- **Weights vs hours:** area weights only order tasks; hours per area come from the grid (and caps). Users expect weights to move hours; Settings explains it.
- **Docs editor** may normalize Markdown (e.g. `-` → `*` bullets); it shows a diff and asks first.
- **Event hand edits:** container events (calendar blocks the planner fills, e.g. "Thesis Deep Work") are still not draggable or editable in the app; deleting an event has no Undo (it asks first); editing a repeating event changes only that occurrence.
- **Urgent is a score, not a rule:** `!urgent` weighs 2 (high 1) in the weighted score, so it usually beats high-priority tasks and far deadlines but still comes after guarded deadlines. Making it a hard "first" rule was offered to the user, not decided.
- **Block panel auto-log** uses the "Time actually spent" field as it stands (planned length by default), so checking a task mid-block logs the full planned time until the user edits it. A checked task shows "0m planned here" (also true after Save log before).
- **Tasks without estimates** use the area default (79 of 88 open tasks on 2026-11-09), so blocks are sized by guesses.

## Ideas (proposed, not approved)

- **Repeat counted from the completion date.** Today every rule is a *catch-up* repeater (org-mode `++`): the next due date is stepped from the current due date until it is past today, so the rhythm is anchored to the calendar. Org-mode's `.+` and Obsidian Tasks' `when done` instead count from when you actually did it, which suits "change the batteries" or a gym session where the *gap* matters more than the slot. Org's rationale for it: "if you forgot to call your father for 3 weeks, it does not make sense to call him 3 times in a single day to make up for it." Would need a token (e.g. `repeat:2w!`), a `nextOccurrence` branch and a RepeatPicker control. Offered to the user 2026-11-10; they chose not to do it then.
- **An end to a repeat** (`until:` / a count). Series currently run forever; "delete the series" from the Tasks view is the only way to stop one.
- **Skip history.** A skip leaves no trace, so a task skipped every week looks identical to one being done on time. A counter or a log line would surface repeats that are not working — worth it only if the user wants the Review screen to show it.
- "No estimate" filter in Today, to add `~` estimates quickly.
- Skip the auto daily brief in dev runs.
- Docs editor: keep the file's bullet style.

## Ideas where AI could help (proposed, not approved)

The scheduler stays deterministic. AI is useful where judgment is needed:
- suggest estimates for tasks without `~` (batch, user confirms);
- turn braindump entries into well-formed tasks under the right heading;
- weekly review summary and "what to drop" suggestions when budgets are over.

## Done

- **Vault:** line-local, id-based parser and editor; watcher; batched git commits under the user's identity.
- **Planner:**
  - containers, chunking, budgets, deep-work cap, pins, warnings; training as an ordinary area (the 7-day cycle reader was removed 2026-11-09; sessions are repeating tasks);
  - finer rules: daily cap, per-task-per-day cap, preferred windows, min block sizes, floating breaks, gaps, deadline slack, stale tasks;
  - strategy: weighted score with deadline guard, weekly hours grid with reserve, ASAP/spread per area and per task (`@spread` / `@asap`);
  - stable re-planning: incremental by default, full daily after 04:00, on a preference change, or via Re-plan.
- **Screens:** Brief (landing), Today, Week, Tasks, Alerts, Inbox, Docs (Milkdown), Review, Settings, ⌘K palette, quick capture.
- **2026-11-09:**
  - blocks: resize (edge drag or hh:mm), draw on the grid or "+ Block" (area / no area, optional auto-fill), removed blocks leave their time free until Re-plan, postpone all tasks in a block;
  - calendar views 00:00–24:00; Today icon shows the day of the month; app renamed AI Center with a white icon;
  - Re-plan options (Balanced / Deadlines first / Deep work first / Light week) with metrics and Shuffle;
  - Alerts page (grouped, with fixes); Today search, sort, Show filter and area chips; compact rows;
  - tasks: `repeat:` (common + custom, every N weeks on weekdays), `postpone:` (🌙), check-off logs a 15-min block;
  - training as ordinary tasks (cycle reader removed); keep-tasks-whole option; training placed before breaks;
  - reserved grid hours placed before other tasks; 0 grid hours = leftover time by priority; "little slack" warning removed;
  - Settings: add/remove areas, several preferred windows, durations as hh:mm;
  - brief uses only visible calendars; dev runs isolated from the installed app's data and vault;
  - priority levels low / medium / high / urgent (`!urgent`, flag chip cycles with distinct icons);
  - checking a task in the block panel saves at once (task done + block log, no Save click);
  - subtasks in the Tasks view (add, nest, un-nest; Tab / ⇧Tab);
  - hand edits of the user's own calendar events (panel edit/delete, drag/resize with Undo; one occurrence; protected/read-only locked).
- **Settings:** selection-based heading → area map, container picker, colour swatches, strategy sliders, grid editor, planning rules, breaks.
- **Time logging:** actual ≠ planned, written to weekly files; budget bars.
- **Calendar:**
  - macOS Calendar provider (Swift EventKit helper) with Google API as the alternative;
  - protected calendars;
  - tagged-only sync with a confirm dialog;
  - calendar edits win;
  - visibility and Busy/Free per calendar and per event.
- **Block editing:** drop a task into a block, add or remove tasks in the panel, remove a block (Delete key) with Undo.
- **Daily brief:** in-app, on first open per day, Claude Haiku read-only with Gmail; editable prompt in `06_Prompts/daily-brief.md`; Run daily brief button; TEMPORARY INBOX suggestions behind an Add click.
- **Update context (⌘U):** Codex Luna (default) or Claude Haiku, with diff review and Keep/Undo.
- **2026-11-10:** skip one occurrence of a repeating task — Today's trash moves a repeating task's `due:` on (`Controller.skipOccurrence`) instead of deleting the line; the Tasks view still deletes the series. Prior art checked: org-mode repeaters (`+` / `++` / `.+`), Obsidian Tasks (`every week` vs `when done`), iCalendar `EXDATE` / `RECURRENCE-ID`.
- **2026-11-10:** single-day sync — **Sync day** in Today's header syncs only the day on screen, through the same approval dialog (`buildSyncDiff(..., day?)` → `syncPreview(day?)` → `SyncDialog day`). The week's Sync still covers the whole window. Other days are never touched by a day sync. Unit-tested (104 tests) and checked in the dev app; not yet run against the real calendar.
- **2026-11-11:** the packaged app is signed with the user's self-signed "AI Center Dev" certificate (`scripts/sign-app.sh`, run by `install-app`), so macOS stops asking for Calendar access after every rebuild. Not an Apple Developer ID: Gatekeeper can still ask for right-click → Open.
- **Handoff:** AGENTS.md, README.md, ROADMAP.md, `scripts/cdp.mjs`.
