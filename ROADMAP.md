# Roadmap

Status of planned work. Approved original plan: `~/.claude/plans/cryptic-baking-prism.md`.

## Next

### Braindump feature (spec pending)
The user will explain this feature. **Don't design or build it until the spec arrives.**
Related, already existing: Inbox view + ⌘⇧Space quick capture write raw entries to `05_Tasks/braindump-inbox.md` under dated `## YYYY-MM-DD` headings (`parseInbox` / `addInboxItem` in `electron/main/vault/`). The new feature may extend or replace that.

### Verify Google Calendar live
Needs the user's OAuth Desktop client (Settings has the steps). Then: dry-run the sync diff, sync one block into Study Schedule, move it, re-sync, and confirm untagged events are untouched.

### Planning quality (proposed, not approved)
- Daily cap on planned hours, lunch and break windows (today the planner fills the whole working day with 15-min buffers).
- Option so overdue tasks don't automatically take the first slots.
- Avoid stacking new blocks beside Codex-created ones for categories without containers.

## Ideas where AI could help (proposed, not approved)
The scheduler stays deterministic. AI is useful where judgment is needed:
- Suggest estimates for tasks without `~` (batch, user confirms).
- Turn braindump entries into well-formed tasks under the right heading.
- Weekly review summary and "what to drop" suggestions when budgets are over.

## Done
- Vault parser/editor (line-local, id-based), watcher, batched git commits.
- Deterministic Motion-style planner (containers, chunking, budgets, deep-work cap, training cycle, pins, warnings).
- Today / Week / Tasks / Inbox / Docs (Milkdown) / Review / Settings, ⌘K palette, quick capture.
- Time logging (actual ≠ planned) → weekly files; budget bars.
- Google Calendar OAuth, reads, tagged-only sync with confirm dialog (unit-tested).
- Update context (⌘U) via Codex `gpt-5.6-terra` medium (default) or Claude `claude-sonnet-5` medium, with diff review and Keep/Undo.
- Packaged app in `/Applications`.
