# Roadmap

Approved original plan: `~/.claude/plans/cryptic-baking-prism.md` (with addendum). Everything here reflects 2026-11-11.

## Direction on this branch (2026-11-21)

This branch (`ai-center-core`) grows the planner into a general agent hub: plan `~/.claude-eth/plans/sequential-questing-sundae.md` (Phase 0 engine layer first). Everything below is the planner's roadmap as of the branch point and is maintained on `main`; merge `main` in regularly. Uniting the branches into `main` is a later, user-triggered step: see "Uniting the two lines" in `AGENTS.md`.

## Open-source readiness: what is left (Phase 6)

- **License:** none chosen yet. The owner decides (MIT or Apache-2.0 are the usual picks); add `LICENSE` and the `package.json` field.
- **Git history:** done locally (2026-11-22): all commits now use the GitHub noreply address. The remote still has the old history, so the first push must be a force push, the owner's call.
- **Planner defaults:** done (2026-11-22): `DEFAULT_PREFERENCES` is neutral (Work / Personal / Training, placeholder calendar "Planner"); the owner's set moved to `tests/sample/preferences.ts` for tests and lives in their vault.
- **Docs:** done for the README (2026-11-22: public overview and install; the planner reference moved to `docs/planner.md`). The repo is public, but `AGENTS.md` and `ROADMAP.md` still describe the owner's routine (university, personal paths, calendars): trim them or move them out, and drop the owner-specific examples in `docs/planner.md`.
- **Done:** no hard-coded vault path (first run creates a starter vault; the setup dialog lets users pick their own folder), generic sample agents, `docs/agents.md`, `CONTRIBUTING.md`.
- **Planner as an optional module** is not done: the app still always opens a vault and the planner screens.

## Open decisions (waiting for the user)

1. **Calendar ownership — decided 2026-11-11: the app owns the blocks** (option 1). The weekly grid and day rules shape the week; Sync is the approval. The user turns off the Sunday Codex automation (`~/.codex/automations/plan-next-eth-week`) themselves in the Codex app (we don't edit `~/.codex`); until then its blocks are filled as containers and may sit next to app blocks. The "six sport sessions" come from TRAINING repeating tasks. Edit adoption ("calendar edits win") is unchanged.
2. **Plan options.** Done: four strategies + Shuffle (2026-11-09), and **Plan with a wish** (2026-11-11; docs/planner.md "When the plan changes").
3. **Braindump feature.** The user will explain it. **Don't design or build it before the spec.** It's related to the Inbox view and ⌘⇧Space capture, which write to `05_Tasks/braindump-inbox.md` under `## YYYY-MM-DD` headings (`parseInbox` / `addInboxItem`).

## Later (agreed with the user, not now)

- **Skeleton-then-fill placement, with a front-loading option.** Today's order grew from patches: pins → training → breaks → deadlines within the guard → reserved grid hours → other tasks by score (each grabs the first free slot in its area's windows, i.e. front-loading). Proposed redesign (2026-11-09): lay down each area's grid hours first, areas in area-weight order (higher weight wins contested windows), then fill those blocks with tasks by score; unfilled blocks are dropped except for "reserve" areas. Keep the current front-loading behaviour as an option. Rewrites the middle of `scheduler/plan.ts`; most placement tests need review; blocks move once on the first full re-plan.
  `plan()` is still one ~510-line function whose passes share closure state; splitting it into named passes was deliberately left for this redesign (2026-11-11), since the redesign rewrites that middle anyway.

## Next (agreed or obvious)

- **Finish verifying Sync live with the user.** Done 2026-11-08: dry run, one block synced, move → pin. Still to do: delete a moved block in Calendar.app and check it disappears (bug fixed since), and confirm untagged events (the user's own, Codex's) stay untouched after a full Sync.
- **Verify single-day sync live** (installed, never run against the real calendar; pushed anyway on 2026-11-11 at the user's go-ahead). Today → **Sync day**. The one thing to watch: syncing a single day must leave planner events on *other* days untouched, including ones that are out of date — the day-scoped diff deliberately does not clean them up. Worth pairing with the full-Sync check above, since both need the installed app.
- **Watch the repeating-task skip live** (installed 2026-11-11). Today's trash on an open repeating task should move its `due:` on and keep the series; the Tasks view should still delete the whole thing. Verified in the dev vault only.
- **Watch the 2026-11-11 (third session) fixes live** — verified in the dev app only:
  - **checking off a repeating task inside a block**: the block should keep showing it checked, and the next occurrence should appear only in a later block (on its own date), not in this one. Unchecking it right away should leave a single open line in `daily-todos.md`. Before the fix the block jumped to the next occurrence, unchecked.
  - **Settings → "Suggest estimates" and "Plan with a wish" ask → Codex**: both answer through `codex exec` (GPT-5.6 Luna). Default stays Claude Haiku.
- **Watch the 2026-11-11 (second session) features live** — all verified in the dev app only:
  - narrow windows on the real screen, including dragging a task from Today's narrow drawer onto the timeline (untested: CDP can't drive HTML5 drag);
  - the weekly review on real data, especially **Archive checked tasks** against the real `daily-todos.md` (it removes `[x]` lines; they go to `05_Tasks/archive/done-YYYY.md`);
  - a day rule (the sample "Lighter half-day" is off until the user turns it on), a habit (`3x/week`), Wrap up, Suggest estimates, Plan with a wish;
  - "New in your todo list": on the first run it knows every existing task, so it should show nothing until the meeting automation, Codex or Obsidian adds a line.
- **User's own setup, no code** (agreed 2026-11-11): Settings → headings Work / Work application / Mentoria / Masters to Outside work, Training's 07–09 window first, drop the DMS heading; turn off the Codex `plan-next-eth-week` and Saturday `weekly-review` automations once the in-app versions are trusted.
- **Vault docs, via Update context with the user's OK:** `03_Workflows/daily-planning.md` still says not to create dated plan files; training Day 1 (vertical pull) and Day 3 (chest) have no TRAINING tasks.
- **The user's Codex `daily-brief` automation** is paused (seen 2026-11-11) but still exists alongside the in-app brief and points to the non-existent path `/Users/glodimendes/Personal Vault/AI Center`. Suggest the user turn it off (they manage it in the Codex app; don't edit `~/.codex`). The vault's `03_Workflows/daily-brief.md` has the same wrong path and should be fixed via Update context or with the user's OK.

## Known limitations

- **Removals:** removing a block (or pressing Delete) asks no confirmation. There's an Undo in the toast; after that, only by editing `overrides.dismissed` in the weekly file.
- **Overrides** (assignments, exclusions, dismissals) stay in the weekly files permanently.
- **Blocks that don't take new tasks:** logged or past blocks.
- **Brief ribbon:** "In meetings / classes" counts events that are free only by a per-event override or the calendar's own free flag.
- **Duplicate blocks:** new blocks may be created next to Codex-made ones for areas without matching containers, until the user turns the Sunday Codex automation off (ownership decided 2026-11-11: the app owns blocks).
- **Packaging:** the app is signed with a local self-signed certificate (`scripts/sign-app.sh`, identity "AI Center Dev"), not an Apple Developer ID, so first launch may still need right-click → Open. `install-app` packages, signs, then replaces the bundle (and removes the old "AI Center Planner.app"); the user must restart the app. The certificate exists to keep the Calendar permission across rebuilds — an ad-hoc bundle's code hash changes every build, so macOS asked for access again each time.
- **Vault auto-commits take whole files:** a manual edit to a file the app later writes (e.g. `daily-todos.md`) is included in the app's next `planner: …` commit.
- **Kept-free slots** are released only by Re-plan or "Let the planner use it"; the morning re-plan keeps them.
- **Re-plan options can look alike:** when the weekly hours grid is what limits each area (the usual case), strategies mostly reorder tasks inside the same blocks; the dialog says "same plan as Balanced right now" when nothing differs.
- **Weights vs hours:** area weights only order tasks; hours per area come from the grid (and caps). Users expect weights to move hours; Settings explains it.
- **Docs editor** may normalize Markdown (e.g. `-` → `*` bullets); it shows a diff and asks first.
- **Event hand edits:** container events (calendar blocks the planner fills, e.g. "Thesis Deep Work") are still not draggable or editable in the app; deleting an event has no Undo (it asks first); editing a repeating event changes only that occurrence.
- **Urgent is a score, not a rule:** `!urgent` weighs 2 (high 1) in the weighted score, so it usually beats high-priority tasks and far deadlines but still comes after guarded deadlines. Making it a hard "first" rule was offered to the user, not decided.
- **Block panel auto-log** uses the "Time actually spent" field as it stands. For a block still running it defaults to the time elapsed so far (to 5 min); for a finished one, to the planned length. A checked task shows "0m planned here" (also true after Save log before).
- **Tasks without estimates** use the area default (79 of 88 open tasks on 2026-11-09), so blocks are sized by guesses. Tasks → **Suggest estimates** fills them in with approval.
- **Week overrides** (a week's own grid, day picks, wish rules, focus) stay in that week's file; a wish's hours and the weekly review's hours share the same week grid, so "Back to usual hours" also drops a wish's hours.
- **"New in your todo list"** goes by task id (file + heading + title), so a task renamed or moved in Obsidian shows up as new too.
- **Wish focus blocks** are pins (`wish:` ids), so they don't move; they're listed under "Active wishes" in the Re-plan dialog with Remove. They hold the heading's tasks only, even if those take less than the block.
- **Checked repeating tasks pile up as `[x]` lines** above each new occurrence until the weekly review archives them. Archiving shifts the open copy's id back to the old one (ids count same-titled tasks in order), which only matters for past blocks and logs naming it.
- **Codex for one-shot questions** runs with its read-only sandbox from an empty folder: it can't write or reach the network, but unlike Haiku (no tools at all) it could read files on disk; Codex has no switch to turn its shell off.
- **Habits:** a pin or block assignment that names a habit takes one of that week's open sessions; a habit with open subtasks is planned as a normal parent (waits for them). Checking a habit off can't be undone from the row (remove its ✓ block's log in the block panel).
- **`plan()` is one long function:** splitting it into passes is left for the skeleton-then-fill redesign (see "Later").

## Ideas (proposed, not approved)

- **Repeat counted from the completion date.** Today every rule is a *catch-up* repeater (org-mode `++`): the next due date is stepped from the current due date until it is past today, so the rhythm is anchored to the calendar. Org-mode's `.+` and Obsidian Tasks' `when done` instead count from when you actually did it, which suits "change the batteries" or a gym session where the *gap* matters more than the slot. Org's rationale for it: "if you forgot to call your father for 3 weeks, it does not make sense to call him 3 times in a single day to make up for it." Would need a token (e.g. `repeat:2w!`), a `nextOccurrence` branch and a RepeatPicker control. Offered to the user 2026-11-10; they chose not to do it then.
- **An end to a repeat** (`until:` / a count). Series currently run forever; "delete the series" from the Tasks view is the only way to stop one.
- **Skip history.** A skip leaves no trace, so a task skipped every week looks identical to one being done on time. A counter or a log line would surface repeats that are not working — worth it only if the user wants the Review screen to show it.
- Docs editor: keep the file's bullet style.

## More Sunsama-style ideas (offered 2026-11-11, not picked yet)

- Morning planning: choose today's tasks against the free time actually left, with an "overcommitted" warning past the daily cap.
- Rollover count: "moved 4 times — reschedule, split or drop?".
- Weekly objectives: the week's focus as checkable goals linked to tasks, with progress.
- Shutdown note: a "what went well" line at Wrap up, shown in the weekly review.
- Focus mode: one task full-screen with a timer that logs actual time.
- Tags across areas (e.g. #applications) with time per tag in Review.
- Email to task: an "Add to tasks" button on the Brief's email items.
- (Offered earlier, not picked: a "Now" mini-window / menu-bar item; natural-language quick add.)

## Ideas where AI could help (proposed, not approved)

The scheduler stays deterministic. AI is useful where judgment is needed:
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
- **2026-11-11 (second session, evaluation plan `~/.claude/plans/foamy-discovering-breeze.md`):**
  - readable at any window size (min 640×480, icon sidebar, drawers/overlays, sideways-scrolling week, portal popovers, scrolling modals; collapsed sidebar sized for the window buttons);
  - safety: Update context undo reverts only the agent's lines; offline calendars don't dismiss blocks; IPC allow-list; CLI runs escalate to SIGKILL;
  - speed: one re-plan per change, throttled focus refresh, async plan cache, serialized git with retry and a visible error;
  - code health: tests run from a fresh clone (synthetic samples), calendar adoption and re-plan cadence are pure and tested, Update context in its own module, BlockPanel split;
  - routine as settings: Day rules, in-app weekly review (archive, focus, week grid, picks), block ownership decided (app owns);
  - projected finish per heading/task, habits `3x/week`, Wrap up the day, Suggest estimates, Plan with a wish (with focus on a heading, after the user's "make tomorrow's first half of the day focus on Tamanduá" failed: the prompt didn't name today/tomorrow and a wish could only set area hours), "New in your todo list".
- **Handoff:** AGENTS.md, README.md, ROADMAP.md, `scripts/cdp.mjs`.

## Chat and agents: done 2026-11-22, next steps

- **Done (uncommitted at the time of writing):** richer answer formatting; model dropdown (available models only); Hand over / Add as task / Copy / Ask again / run details on each message, per section and on selected text; agent-suggested handoffs as one-click lines under the answer; handoffs continue in the target agent's own chat; routing suggestion by word overlap.
- **Also done:** waiting queue (chat turns and handoffs to a busy agent wait, show as pending bubbles, survive a restart; `Supervisor.queueFile`); handoff packet (objective, material, expected answer, long text as a file); chain limit of 3 and a duplicate guard; "answered ↗" note and **Send back**; chain view with tokens and cost in Activity. An `act` agent's `add-task` in chat needs no click (owner's decision, same as the existing `act` rule).
- **Not done, offered:** live streaming of the answer while the agent works (engines already emit `text` events); "Ask an agent" from task rows, Home cards, Docs and ⌘K with the item as context.
- **Protocols, later (researched 2026-11-22):** the app uses A2A's vocabulary, not its wire protocol. Two possible additions: a small MCP server exposing `list_agents` and `propose_handoff` (it only creates an approval, never runs anything) so a CLI agent proposes a handoff through a tool instead of a parsed fenced block; and an A2A server/client adapter (agent card per agent on localhost, or a new engine type that calls a remote A2A agent). Both need a network listener or outbound auth, so only when something outside the app needs to talk to these agents.

## Idea (user, 2026-11-22): a modular, editable Home

Home (formerly Brief) should become editable and modular: people arrange the cards that show their main agent interactions and outputs, scheduled or not (e.g. a daily-brief agent's answer, an agent's latest output file, a chat shortcut, today's plan, due tasks). Not designed yet; build it from generic primitives (widgets backed by agents, sources and views), not around one use case. The fixed "Active task notes" card was removed for this reason (it depended on one personal note convention).
