# Roadmap

Open decisions, next steps and known limits. Last revised 2026-11-22. For how the code is organised and the rules for working on it, see `AGENTS.md`.

## Open-source readiness: what is left

- **License:** done (2026-11-22): MIT, copyright under the GitHub handle; `LICENSE` and the `package.json` field.
- **Personal sample data:** done (2026-11-22): the test samples, the tests that named projects, calendars and accounts, and the examples in `docs/planner.md` use neutral names, and the planner doc now states the real shipped defaults. The earlier versions remain in the public git history. Local copies of real files for extra checks go in `tests/fixtures/` (gitignored); keep any such file out of commits.
- **Done:** all commits use the GitHub noreply address (history rewritten and force-pushed 2026-11-22); planner defaults are neutral (Work / Personal / Training, placeholder calendar "Planner"); the README is written for a public audience and the planner reference moved to `docs/planner.md`; no hard-coded vault path (first run creates a starter vault, the setup dialog lets users pick a folder); generic sample agents; `docs/agents.md`; `CONTRIBUTING.md`.
- **Planner as an optional module** is not done: the app still always opens a vault and the planner screens.

## Startup setup: the framework every install works on

**Goal:** a defined framework (organization and rules) that AI Center works upon from the first launch, so anyone who installs it can use it without reverse-engineering someone else's vault. It also has to stay adjustable: users keep their own layout and edits, and the framework can be updated without overwriting them.

**Where it stands (2026-11-22).** Every vault path is in one module, `shared/paths.ts`, used by the code, the prompts and the UI texts, and the layout uses plain lowercase names. A fresh install gets a starter vault with the pieces the app expects: `AGENTS.md` (entry point with a "What to load" table) and `CLAUDE.md` (`@AGENTS.md`), `workflows/assistant-file-update-rules.md` and `context-maintenance.md` (generic, short), `context/about-me.md`, `context/current-priorities.md` (with "## Active Priority Areas"), `tasks/daily-todos.md`, `tasks/braindump-inbox.md`, plus empty `projects/` and `prompts/agents/`. The templates live in `electron/main/vault/framework.ts`. A folder the user chooses (Setup or Settings → General) gets the framework files it lacks, never overwriting one; a vault in another layout (numbered folders) gets nothing and a note. The check for missing files runs at every start, so after every update. Setup has a sample-agents step and Home a "Get set up" checklist. Still missing: mapping other layouts, and a live test on a fresh install.

**Scope:**
1. **One layout spec, without numbered prefixes.** Done 2026-11-22: `shared/paths.ts` defines it (`AGENTS.md`, `context/`, `projects/`, `workflows/`, `tasks/`, `prompts/agents/`, `decisions/`, `references/`), used by the starter, the Docs groups, the prompts and the UI. Still open: existing vaults with another layout (the old numbered folders `05_Tasks`, `06_Prompts`, …) should be detected or mapped per vault and renaming offered, never forced; today they must be renamed by hand. Which files the app owns versus the user is part of the spec (see `AGENTS.md` rule 3).
2. **Ship the rules with the starter vault.** Done 2026-11-22. Generic `context-maintenance.md` and `assistant-file-update-rules.md` (what an AI may edit, what needs confirmation), a `current-priorities.md` template, and a vault `AGENTS.md` that explains the layout (with a `CLAUDE.md` pointer). Update context must work on a fresh vault with no errors.
3. **A real first-run flow.** Done 2026-11-22 apart from a live test (the maintainer will test it later): a chosen folder is completed automatically and Setup lists what was added; Setup offers sample agents; the Home checklist (vault framework, AI tool, calendar, areas, first sync, first agent) can be dismissed and brought back from Settings → General. Original scope: Choose a folder (new starter or existing); when adopting an existing vault, detect missing framework pieces and offer to add them (never overwrite, line-local edits only); then areas, calendar, AI engines and optional sample agents. A short dialog covers the essentials (folder, calendar, AI tools); a checklist card on Home (calendar connected, engine found, areas set, first sync done, first agent) stays until everything is done or dismissed.
4. **Rules enforced, not just written.** Surface the hard rules the code already enforces (approvals for outside effects, line-local edits, protected calendars, AI diffs reviewed) in the setup and in Settings, so users know what the framework guarantees.
5. **Adjustable.** Folder names and key file paths are settings (there is already `settings.agentsDir`), so users with an existing vault map their own layout instead of renaming it.
6. **Updatable.** Partly done 2026-11-22: the setup check runs at every start (so after every update) and offers to add missing framework files; existing files are never changed. Offering newer shipped templates to existing vaults (versioned templates, a diff to adopt, never an overwrite) was built and then taken out as premature: it belongs to the "evolve" idea below.
7. **Tests.** The starter vault contains every piece the app expects; a fresh vault passes the setup check; Update context runs against it.

**Decided (2026-11-22):** an opinionated default layout with no numbering, plus mapping for existing vaults; the rules files are plain Markdown in the vault with versioned templates and a diff to adopt updates (the hard safety rules stay enforced in code either way); first run is a dialog followed by a checklist on Home.

**Later (decided 2026-11-22):** mapping other layouts (item 5 and the rest of item 1) waits. **Still open:** where a vault's layout choice is stored (app settings, or a small file inside the vault so it travels with it); and whether and how to offer migrating an existing numbered vault.

**Idea: an "evolve" setting (maintainer, 2026-11-22; to specify).** A setting that lets the framework grow with the user instead of staying at the shipped templates. Questions to settle first: what evolves (the rules files, the "What to load" table, the templates, the folder set); who proposes changes (the app from how the vault is used, an agent, or the shipped updates); how far it may go on its own (always a reviewed diff, like Update context, or adopting unchanged-template updates automatically); and how it stays within the hard rules (line-local edits, nothing applied without the user). It also covers bringing newer shipped templates into existing vaults (item 6): one way, tried and set aside, records a hash of each template the app writes so only untouched copies are replaced and edited ones get a note.

## Open decisions

1. **Braindump feature.** The maintainer will specify it. **Don't design or build it before the spec.** It relates to the Inbox view and ⌘⇧Space capture, which write to `tasks/braindump-inbox.md` under `## YYYY-MM-DD` headings (`parseInbox` / `addInboxItem`).

Decided: **the app owns the calendar blocks it creates** (2026-11-11). The weekly grid and day rules shape the week, Sync is the approval, and calendar edits by the user win. If another tool also writes blocks to the same calendars, its blocks are filled as containers and may sit next to the app's.

## Later (agreed, not now)

- **Skeleton-then-fill placement, with a front-loading option.** Today's order grew from patches: pins → training → breaks → deadlines within the guard → reserved grid hours → other tasks by score (each grabs the first free slot in its area's windows, i.e. front-loading). Proposed redesign (2026-11-09): lay down each area's grid hours first, areas in area-weight order (higher weight wins contested windows), then fill those blocks with tasks by score; unfilled blocks are dropped except for "reserve" areas. Keep the current front-loading behaviour as an option. This rewrites the middle of `scheduler/plan.ts`; most placement tests need review; blocks move once on the first full re-plan. `plan()` is still one ~510-line function whose passes share closure state; splitting it into named passes was deliberately left for this redesign.

## Next

- **Watch recent work on a real vault** (everything below was verified in the dev app and by tests only):
  - single-day sync (**Sync day**): syncing one day must leave planner events on other days untouched, including out-of-date ones; and a full Sync must leave untagged events (the user's own, other tools') untouched;
  - checking off a repeating task inside a block: the block keeps showing it checked, the next occurrence appears only in a later block, unchecking right away leaves a single open line;
  - Today's trash on a repeating task skips one occurrence; the Tasks view still deletes the series;
  - the weekly review on real data, especially **Archive checked tasks** (it removes `[x]` lines; they go to `tasks/archive/done-YYYY.md`);
  - a day rule, a habit (`3x/week`), Wrap up, Suggest estimates, Plan with a wish (also through Codex);
  - narrow windows, including dragging a task from Today's narrow drawer onto the timeline (CDP can't drive HTML5 drag);
  - the chat and agents work: an agent-proposed handoff through a real model, the long-text file spill, Send back on a real chain, the queue across a real restart, the model dropdown for Codex and Ollama;
  - agent organization: importing real files written by Codex or Claude Code, groups and Chat pins over days of use, an agent's data sources (`file` sources outside the vault) in a real run;
  - first launch on a fresh install (the Setup dialog, choosing an existing folder that lacks the framework, the Home checklist): tested in the dev app only; the maintainer will test it on a fresh install later.
- **Live streaming of agent answers:** done 2026-11-22 at message level (Claude, Codex) and as typed (Ollama). Token-level Claude streaming (`--include-partial-messages`) is the possible next step.
- **"Ask an agent"** from task rows, Home cards, Docs and ⌘K, with the item as context.
- **The daily brief as an agent.** The maintainer wants the built-in brief to become an agent (or part of one) in the hub, instead of its own code path in `context/brief.ts`. To keep: read-only tools, calendar only from the app's visible calendars, Gmail read-only, the Home cards (they parse the `## ` headings of `BRIEF_FORMAT`, which then belongs to the agent's output contract), suggested todos only on a click, no auto-run in dev. The vault's `prompts/daily-brief.md` can stay as the agent's instructions; the app-specific parts (output format, read-only rule, calendar handling) stay in code, not in the prompt.
- **An agent to replace the removed "AI preparation opportunities" Home card.** Exists as a user-defined agent in the maintainer's vault (the daily brief no longer covers it); shipping a generic sample is optional.
- **Phase 2/3 leftovers:** route the built-in brief and estimates through the budget gate and `limits`; watch the agents folder for changes; "New agent from this run"; `create-event` and `api-call` executors; Strava/Garmin sources.

## Future goals (maintainer, 2026-11-22)

Both to be measured before anything is changed; nothing here is designed yet.

- **App optimization: storage and processing.**
  - *Storage:* app data only grows today: `runs/*.jsonl`, `chats/`, `goals/`, `queue.json`, the plan cache; the vault's git history gets a `planner: …` commit for most saves and the weekly files keep their overrides forever (see Known limitations). Measure first, then rotate or prune logs and transcripts, and consider squashing the app's own commits.
  - *Processing:* every state push rebuilds the whole `AppState` (vault parse, plan, framework check, agent registry listing that reads every agent file, usage totals); the renderer bundle is about 4.4 MB. Candidates: cache what didn't change, re-plan only on relevant changes, read agent files only when the folder changes, split the bundle.
- **AI and agents' usage optimization.** Fewer tokens and calls for the same result: keep prompts pointing to files instead of pasting them (already the rule for built-in prompts), trim what source bundles and handoff packets carry, reuse chat sessions, choose the cheapest model that does the job per agent, and route the built-in brief and estimates through the budget gate (Phase 2/3 leftover). Make cost visible per agent and per week in Activity so the user can see what is worth running. The usage log (`metrics/`, `npm run usage-report`, 2026-11-22) is the measuring tool: read it before changing anything, and show it in the app later.

## Protocols, later

The app uses A2A's vocabulary (task states, context id, message, artifact), not its wire protocol. Two possible additions: a small MCP server exposing `list_agents` and `propose_handoff` (it only creates an approval, never runs anything), so a CLI agent proposes a handoff through a tool instead of a parsed fenced block; and an A2A server/client adapter (an agent card per agent on localhost, or an engine type that calls a remote A2A agent). Both need a network listener or outbound auth, so only when something outside the app needs to talk to these agents.

## Idea: a modular, editable Home

Home should become editable and modular: people arrange the cards that show their main agent interactions and outputs, scheduled or not (a daily-brief agent's answer, an agent's latest output file, a chat shortcut, today's plan, due tasks). Not designed yet; build it from generic primitives (widgets backed by agents, sources and views), not around one use case. The fixed "Active task notes" card was removed for this reason (it depended on one personal note convention).

## Known limitations

- **Removals:** removing a block (or pressing Delete) asks no confirmation. There's an Undo in the toast; after that, only by editing `overrides.dismissed` in the weekly file.
- **Overrides** (assignments, exclusions, dismissals) stay in the weekly files permanently.
- **Blocks that don't take new tasks:** logged or past blocks.
- **Brief ribbon:** "In meetings / classes" counts events that are free only by a per-event override or the calendar's own free flag.
- **Duplicate blocks:** new blocks may be created next to blocks another tool made for areas without matching containers.
- **Packaging:** the app is signed with a local self-signed certificate (`scripts/sign-app.sh`), not an Apple Developer ID, so first launch may need right-click → Open. `install-app` packages, signs, then replaces the bundle; the app must be restarted. The certificate exists to keep the Calendar permission across rebuilds.
- **Vault auto-commits take whole files:** a manual edit to a file the app later writes (e.g. `daily-todos.md`) is included in the app's next `planner: …` commit.
- **Kept-free slots** are released only by Re-plan or "Let the planner use it"; the morning re-plan keeps them.
- **Re-plan options can look alike:** when the weekly hours grid is what limits each area (the usual case), strategies mostly reorder tasks inside the same blocks; the dialog says "same plan as Balanced right now" when nothing differs.
- **Weights vs hours:** area weights only order tasks; hours per area come from the grid (and caps). Users expect weights to move hours; Settings explains it.
- **Docs editor** may normalize Markdown (e.g. `-` → `*` bullets); it shows a diff and asks first.
- **Event hand edits:** container events (calendar blocks the planner fills) are not draggable or editable in the app; deleting an event has no Undo (it asks first); editing a repeating event changes only that occurrence.
- **Urgent is a score, not a rule:** `!urgent` weighs 2 (high 1) in the weighted score, so it usually beats high-priority tasks and far deadlines but still comes after guarded deadlines. A hard "first" rule was offered, not decided.
- **Block panel auto-log** uses the "Time actually spent" field as it stands. For a block still running it defaults to the time elapsed so far (to 5 min); for a finished one, to the planned length. A checked task shows "0m planned here".
- **Tasks without estimates** use the area default, so blocks are sized by guesses. Tasks → **Suggest estimates** fills them in with approval.
- **Week overrides** (a week's own grid, day picks, wish rules, focus) stay in that week's file; a wish's hours and the weekly review's hours share the same week grid, so "Back to usual hours" also drops a wish's hours.
- **"New in your todo list"** goes by task id (file + heading + title), so a task renamed or moved in another editor shows up as new too.
- **Wish focus blocks** are pins (`wish:` ids), so they don't move; they're listed under "Active wishes" in the Re-plan dialog with Remove. They hold the heading's tasks only, even if those take less than the block.
- **Checked repeating tasks pile up as `[x]` lines** above each new occurrence until the weekly review archives them. Archiving shifts the open copy's id back to the old one (ids count same-titled tasks in order), which only matters for past blocks and logs naming it.
- **Codex for one-shot questions** runs with its read-only sandbox from an empty folder: it can't write or reach the network, but unlike Haiku (no tools at all) it could read files on disk; Codex has no switch to turn its shell off.
- **Habits:** a pin or block assignment that names a habit takes one of that week's open sessions; a habit with open subtasks is planned as a normal parent (waits for them). Checking a habit off can't be undone from the row (remove its ✓ block's log in the block panel).
- **Agent queue:** a handoff or message to a busy agent waits (up to 5 per agent); a run that was *running* when the app quit is not replayed. An `act` agent's `add-task` in chat needs no click (the existing `act` rule).

## Ideas (proposed, not approved)

- **Repeat counted from the completion date.** Today every rule is a *catch-up* repeater (org-mode `++`): the next due date is stepped from the current due date until it is past today. Org-mode's `.+` and Obsidian Tasks' `when done` instead count from when you actually did it, which suits "change the batteries" or a gym session where the *gap* matters more than the slot. Would need a token (e.g. `repeat:2w!`), a `nextOccurrence` branch and a RepeatPicker control.
- **An end to a repeat** (`until:` / a count). Series currently run forever; "delete the series" from the Tasks view is the only way to stop one.
- **Skip history.** A skip leaves no trace, so a task skipped every week looks identical to one being done on time. A counter or a log line would surface repeats that are not working.
- **Docs editor:** keep the file's bullet style.
- **Sunsama-style ideas** (offered, not picked): morning planning against the free time actually left with an "overcommitted" warning; a rollover count ("moved 4 times — reschedule, split or drop?"); weekly objectives as checkable goals linked to tasks; a shutdown note at Wrap up; focus mode (one task full-screen with a timer that logs actual time); tags across areas with time per tag in Review; "Add to tasks" on the Brief's email items; a "Now" mini-window or menu-bar item; natural-language quick add.
- **AI where judgment is needed** (the scheduler stays deterministic): turn braindump entries into well-formed tasks under the right heading; weekly review summary and "what to drop" suggestions when budgets are over.

## Done

- **Vault:** line-local, id-based parser and editor; watcher; batched git commits under the user's identity.
- **Planner:** containers, chunking, budgets, deep-work cap, pins, warnings; training as an ordinary area (sessions are repeating tasks); finer rules (daily cap, per-task-per-day cap, preferred windows, min block sizes, floating breaks, gaps, deadline slack, stale tasks); weighted score with deadline guard, weekly hours grid with reserve, ASAP/spread per area and per task; stable re-planning (incremental by default, full daily after 04:00, on a preference change, or via Re-plan); Re-plan options (Balanced / Deadlines first / Deep work first / Light week) with metrics and Shuffle; Plan with a wish (date limits, a day's hours, a strategy, focus time on a heading); day rules; weekly review (archive, focus, week grid, picks); projected finish per heading and task; habits (`3x/week`); Wrap up the day; Suggest estimates.
- **Screens:** Home (formerly Brief), Today, Week, Tasks, Alerts, Inbox ("New in your todo list" + braindump), Docs (Milkdown), Review, Chat, Agents, Settings, ⌘K palette, quick capture. Readable at any window size.
- **Tasks:** `repeat:` (common and custom, weekdays, every N weeks), `postpone:`, subtasks that inherit deadline and timing, four priority levels, drag to reorder, skip one occurrence, check-off logs a short block.
- **Blocks:** resize, draw, edit tasks in a block, remove with Undo, postpone, keep-tasks-whole option.
- **Time logging:** actual versus planned in weekly files; budget bars.
- **Calendar:** macOS Calendar provider (Swift EventKit helper) with Google API as the alternative; protected calendars; tagged-only sync with a confirm dialog (week or single day); calendar edits win; hand edits of the user's own events; visibility and Busy/Free per calendar and per event; web edits pulled without opening Calendar.app.
- **Daily brief:** in-app, first open per day, read-only, with an editable prompt; polished cards (priority rows without stray checkboxes, long cards folded after 4 points with Show more); TEMPORARY INBOX suggestions behind an Add click.
- **Update context (⌘U):** Codex or Claude edits the vault; diff review with Keep/Undo; undo reverts only the AI's lines.
- **Vault framework (2026-11-22):** every vault path in `shared/paths.ts`, plain lowercase folders, root `AGENTS.md` + `CLAUDE.md`; shipped templates (`vault/framework.ts`); a chosen folder gets the files it lacks; the missing-files check at every start; Setup with sample agents; the Home checklist; a new vault gets its own git history.
- **Agent organization (2026-11-22):** only agents made or accepted in the app count; files other tools write are found and imported (Claude Code and Codex formats read leniently) or ignored; named, ordered groups; Chat pins; frontmatter with an unquoted `: ` is read instead of failing.
- **Agent hub:** Markdown agent definitions, permissions and approvals, engines (Claude, Codex, Antigravity, Ollama, custom command) with account profiles and usage windows, triggers, sources (vault, files, URLs, Gmail draft-only), goals with a coordinator, chat with Markdown rendering and a central thread, Hand over (whole answer, section or selection, suggested agent), agent-proposed handoffs, a persisted queue for busy agents, handoff packets with chain limits, chain view with cost, model dropdown.
- **Packaging:** signed app via `scripts/sign-app.sh`; the README has install steps.
