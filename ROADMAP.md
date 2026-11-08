# Roadmap

Approved original plan: `~/.claude/plans/cryptic-baking-prism.md` (with addendum). Everything here reflects 2026-11-08.

## Open decisions (waiting for the user)

1. **Calendar ownership.** Today the user's weekly Codex automation (`~/.codex/automations/plan-next-eth-week`) proposes the week in chat and, after approval, creates blocks (thesis 18–22 h, outside work 12 h, six sport sessions, one lighter half-day). The user edits blocks afterwards. Options:
   1. **App owns the blocks** from the weekly grid; Sync is the approval; Codex stops creating blocks. This is the recommended option.
   2. App proposes, Codex applies.
   3. Codex owns the blocks, the app only fills them.
   4. Split by area.
   5. Mixed (current behaviour).
   6. No blocks: the plan lives only in the app.

   Edit adoption ("calendar edits win") is built and works with all of them. **Don't change container behaviour until the user decides.**
2. **Plan options.** Re-plan would offer 3–4 strategy variants (Balanced / Deadlines first / Deep-work first / Light week), each with a mini week strip and metrics (thesis hours, deadlines at risk, evening load, task switches, free time), plus **Shuffle**: a different arrangement under the same strategy, e.g. seeded tie-breaking. Optional **"Plan with a wish"**: Haiku turns a sentence into temporary planner settings; the deterministic planner still places the blocks. Waiting for a go (and whether to include the wish box).
3. **Braindump feature.** The user will explain it. **Don't design or build it before the spec.** It's related to the Inbox view and ⌘⇧Space capture, which write to `05_Tasks/braindump-inbox.md` under `## YYYY-MM-DD` headings (`parseInbox` / `addInboxItem`).

## Next (agreed or obvious)

- **Verify Sync live with the user**:
  1. Dry-run the diff.
  2. Sync one block to Study Schedule.
  3. Move it in Calendar.app and check it becomes a pin.
  4. Delete one and check it isn't recreated.
  5. Confirm untagged events are untouched.
- **Lighter half-day rule.** The user's planning routine asks for one per week; the planner has no such rule yet (e.g. "no work after 13:00 on a chosen day").
- **The user's Codex `daily-brief` automation** still runs alongside the in-app brief and points to the non-existent path `/Users/glodimendes/Personal Vault/AI Center`. Suggest the user turn it off (they manage it in the Codex app; don't edit `~/.codex`). The vault's `03_Workflows/daily-brief.md` has the same wrong path and should be fixed via Update context or with the user's OK.

## Known limitations

- **Removals:** removing a block (or pressing Delete) asks no confirmation. There's an Undo in the toast; after that, only by editing `overrides.dismissed` in the weekly file.
- **Overrides** (assignments, exclusions, dismissals) stay in the weekly files permanently.
- **Blocks that don't take new tasks:** logged or past blocks, and training blocks.
- **Brief ribbon:** "In meetings / classes" counts events that are free only by a per-event override or the calendar's own free flag.
- **Duplicate blocks:** new blocks may be created next to Codex-made ones for areas without matching containers. That goes away if the user picks ownership option 1.
- **Packaging:** the app is unsigned (first launch may need right-click → Open). `install-app` replaces the bundle; the user must restart the app.

## Ideas where AI could help (proposed, not approved)

The scheduler stays deterministic. AI is useful where judgment is needed:
- suggest estimates for tasks without `~` (batch, user confirms);
- turn braindump entries into well-formed tasks under the right heading;
- weekly review summary and "what to drop" suggestions when budgets are over.

## Done

- **Vault:** line-local, id-based parser and editor; watcher; batched git commits under the user's identity.
- **Planner:**
  - containers, chunking, budgets, deep-work cap, training cycle, pins, warnings;
  - finer rules: daily cap, per-task-per-day cap, preferred windows, min block sizes, floating breaks, gaps, deadline slack, stale tasks;
  - strategy: weighted score with deadline guard, weekly hours grid with reserve, ASAP/spread per area and per task (`@spread` / `@asap`);
  - stable re-planning: incremental by default, full daily after 04:00, on a preference change, or via Re-plan.
- **Screens:** Brief (landing), Today, Week, Tasks, Inbox, Docs (Milkdown), Review, Settings, ⌘K palette, quick capture.
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
- **Handoff:** AGENTS.md, README.md, ROADMAP.md, `scripts/cdp.mjs`.
