# AGENTS.md: context for AI assistants working on this repo

Read this first, then `README.md` (what the app is, install, safety), `docs/planner.md` (screens, task syntax, planning rules), `docs/agents.md` (agents) and `ROADMAP.md` (open decisions, next steps, known limits). Codex reads this file directly; Claude Code reads it via `CLAUDE.md`.

## What this is

AI Center (formerly AI Center Planner) is a macOS Electron app with two parts that share one data folder:

- a **planner**: a Motion-style routine organizer over the user's Markdown knowledge base ("the vault", any folder, typically an Obsidian vault under git) and their calendars (macOS Calendar by default, Google directly as an option);
- an **agent hub**: user-defined AI agents (Markdown files in the vault) with permissions, approvals, triggers, chat, a queue and handoffs between agents.

The UI is in English. Task text is whatever language the user writes, and it must be kept verbatim.

## State (2026-11-22)

The planner and the agent hub are one app on `main`, pushed to the public repo `glodimendes/ai-center-app` (default branch `main`). History was rewritten once so every commit uses the GitHub noreply address, and force-pushed with the maintainer's OK; **any further force push needs their explicit OK again**. A local restore tag `pre-agent-hub-merge` marks `main` before the hub was merged. The README is written for a public audience; the planner reference lives in `docs/planner.md`. Personal sample data was replaced with neutral names in `tests/` and `docs/planner.md` (the old text is still in the public git history). License: MIT (`LICENSE`, 2026-11-22). Still open for going public: see ROADMAP "Open-source readiness".

**Handoff (end of 2026-11-22, fourth session):** the Agents features were made dependable for daily use. One commit on `main` (pushed), **not installed**, exercised in the dev app only (the dev QA agents QA Reader / QA Editor / QA Codex still exist in the dev data folder). What was added (docs: `docs/agents.md` "Agents page", "Chat", "Goals"):
- **Run history survives restarts:** `agents/history.ts` (`loadHistory`, `runFromLog`) rebuilds `Run`s from `runs/YYYY-MM/<id>.jsonl`; `Supervisor.seed`, `HISTORY_CAP` 200; the `queued`/`end` log events now also carry `agentName`, `profile`, `chat`, `queuedAt`, `outputFile`. A log with no `end` shows as cancelled "Interrupted when the app closed".
- **Notifications:** `agents/notice.ts` (pure: `shouldNotify`, `notice`) + `notify.ts` (Electron shim, dock badge = pending approvals + paused runs + review); `Supervisor` takes an `onEvent('failed'|'paused')`; the hub raises `alert()` for failures, pauses, approvals, review, goals; Settings → General switch `agentNotifications`; click navigates via the new `navigate` channel (`window.api.onNavigate`). Never contains answer text.
- **Streaming:** Claude assistant text blocks now emit `text` events (message-level, no `--include-partial-messages`); `RunContext.onText` → `Execute` signal `text()` → `Run.partial` (throttled 150 ms, not logged); Chat shows a growing `StreamingAnswer`.
- **Memory (opt-in per agent, `memory: true`):** `agents/memory.ts` (app data `memory/<id>.md`, 8 KB file cap, 4000-char prompt cap, `removeNote`); `MEMORY_FORMAT` in the prompt; action kind `remember`. **Hard rule 8 exception (user-approved 2026-11-22):** `canAutoRun('remember', any permission)`; notes are kept at once and shown under the message as `RememberedNote` with Undo (`ApprovalStore.undo`, `undoRemember` API). Chat header `MemoryMenu` (switch on, edit/clear notes); agent editor has the same field.
- **Adapting an agent from its chat:** action kind `update-instructions` (chat runs only, never built-ins, never auto-run); `ADAPT_FORMAT` is added to chat prompts; the card shows Now/Proposed and **Apply** writes the definition through the registry. `chat.freshSession` makes the next turn start a new CLI session (transcript carried as text) after an applied change or a saved change of instructions/memory (`AgentHub.save` → `restartChat`).
- **Cost view:** `usageTotals` has `month`, `dailyTotals` (14 days), state `costDays`; Activity → Cost (`Agents.tsx` `Cost`): period switch, total, aligned per-agent table, the per-day chart only when two or more days have runs.
- **Goals:** `GoalRunner.resume` also works from `stopped`/`error` and gives a fresh budget (`Goal.turnsBase`/`delegationsBase`; limits count what was used since); Goals UI has Continue, Run again, Edit and run, a folder link; 50 goals shown.
- **Edits are made as separate Edit calls, not long shell scripts** (the maintainer objected to a scripted edit once).
- **Not verified:** a real model proposing a note or an instruction change (the prompts are untested against Claude/Codex), notifications and the dock badge on screen, restart history on the real app, token-level streaming (not built), Cost with real data over several days.
- **Left for later (survey):** editor Run-now/test, triggers validation, re-run or save a run as a new agent, duplicate/export/more samples, richer approvals (edit/retry/bulk), file-by-file review and parallel propose runs, "Ask an agent" from tasks/Home/Docs/⌘K, per-agent timeout and richer schedules, `create-event`/`api-call` executors (and remove them from the agent prompt until they exist).

**Earlier handoff (end of 2026-11-22, third session):** the chat was made usable for real work; it is on `main`, pushed in two commits (the feature, then a `/simplify` cleanup), **not installed** (the maintainer hasn't asked; run `npm run install-app` when they do) and only exercised in the dev app. What was added:
- **Model and effort per conversation** (`components/ModelPicker.tsx`, pill left of Send): `ChatOverride` per chat (`chat.override`, `AgentsState.chatModels`), `AgentHub.effective(def)` swaps account/model/effort at enqueue (and in queue restore), `chatModels()` lists every account with `availableModels` + `EFFORTS` (`engines/models.ts`). Model/effort changes keep the CLI session; an account change starts a new one (`chat.sessionProfile`). The agent editor has an Effort field; the agent's own model/effort is the default, New chat resets.
- **Attachments and `@` files:** `agents/attachments.ts` (`attachmentBlock`: paths for claude/codex/agy, inline text for ollama/command; `attachDirs` adds outside folders to `--add-dir`), `agents/files.ts` (`findFiles`/`rankFiles` over the conversation's folders and the vault), paperclip, drag and drop (`window.api.pathForFile`), pasted images (`saveAttachment` → app data `attachments/<chat>/`), chips (`FileChips.tsx`). `ChatMessage.files`, `AgentMessage.attachments` (persisted in `queue.json`). Codex images are only named in the prompt (no `-i`).
- **`/` refers to an agent, `@` to a file.** `parseMentions` (`agents/capture.ts`) now reads `/agent` (whole words only, unknown names left alone, no error); in Central it sends to that agent, in an agent chat it adds a note so the agent may propose a `run-agent` handoff (click still needed). Quick capture (⌘⇧Space) keeps `@agent`.
- **Folders:** `AgentDef.folders` (extra folders, frontmatter `folders:`) plus `workdir` as main; `resolveDirs` (`agents/runner.ts`) returns cwd + extra (vault always, nested ones dropped); per-conversation extras (`chat.extra`, `chatSetExtraFolders`); `components/FolderMenu.tsx` in the chat header (change main, add/remove folders, vault fixed, "Save as default"); `chooseFolder` API; the agent editor's "Folders" block. Codex `exec resume` in edit mode now passes `sandbox_workspace_write.writable_roots`.
- **Cleanup after review (second commit):** one `inside()` (exported from `agents/attachments.ts`); `vaultDirs` removed and `RunContext.extraDirs` required; `Engine.readsFiles` (claude, codex, agy true; ollama, command false) decides paths vs inline text for attachments; `AgentHub.checkModel` is shared by `save` (now also checks effort) and `setChatModel`; `chatSettings()` builds the per-chat state maps in one pass; `baseName`/`tidy` in `src/lib/util.ts`. Left as is on purpose: attachment/`/agent` notes are appended to the message text in `execute` rather than in `buildPrompt`; `chat.sessionProfile` (clearing the session on an account switch would lose the carried transcript); the sync file walk in `agents/files.ts` (first `@` lookup in a huge folder can stall) and the model list loading every account on open (a slow Ollama delays it up to ~4 s).
- **Dev data:** mock agents QA Reader / QA Editor / QA Codex exist in the dev data folder (extra files in `/tmp/qa-extra`); the on-screen check covered the `/` menu and the folder menu only.
- **Not verified:** the `@` file menu and attachment chips on screen, a real model turn with an attachment or a dropped PDF/image, an account switch mid-chat, the `/agent` handoff note through a real model, Codex resumed edits writing into extra folders (the `writable_roots` config is untested against the real CLI), pasting an image.

**Earlier handoff (end of 2026-11-22, second session):** everything is committed and pushed (`main` = `origin/main`) and the installed app runs the latest code; the maintainer uses it daily. Work of this session, after the first handoff: Chat tags render as white text in a rounded accent pill; chat message text is selectable (`select-text` on the message list; the body is `user-select: none`); a live test of goals and handoffs (worked, with real Haiku); then four changes in one commit: parallel runs (`MAX_PARALLEL` 3, review runs alone, goal delegations side by side), workspaces (own empty folder per agent, vault always added; chat-header folder chip; agent editor "Working folder"), peer `ask` questions inside goals, and the usage log (`electron/main/metrics.ts`, `npm run usage-report`). See the bullets "Workspaces", "Goals in parallel, peer questions" and "Usage log" below. Nothing is in progress. Start the next session by asking the maintainer what they want next; if they want optimization, first run `npm run usage-report -- --packaged` after a few days of real use and read it before changing anything.

**What exists (the agent hub, generic by design, see "Design rule"):**
- **Core** `electron/main/agents/` (no Electron imports): `engines/` (claude, codex, agy, ollama, custom command; `RunSpec` modes read/edit/tools/ask, sessions for chat; `failureMessage` turns a failed run into a readable reason), `definition.ts` + `registry.ts` (agents are Markdown files in `prompts/agents/`, but only ones created or accepted in the app count: files other tools drop there are "found" until imported (`readForeignAgent` reads Claude/Codex formats leniently) or ignored; groups and Chat pins live in app data `agents-org.json`, per folder; the first time a folder is seen, its files are accepted and pinned), `permissions.ts`, `actions.ts` (`ApprovalStore`: only `approve()` runs an executor), `supervisor.ts` (queue, up to `MAX_PARALLEL` (3) runs at once: never two of one agent, a propose/act run alone; budget pause gate, `runs/*.jsonl`, persisted waiting queue), `usage.ts` (5-hour and weekly windows), `triggers.ts`, `capture.ts` (`@agent`), `sources.ts` + `gmail.ts` (Gmail is draft-only by construction), `samples.ts`, `goals.ts`, `runner.ts`.
- **App glue:** `electron/main/agent-hub.ts`, `gmail-auth.ts`, `vault/starter.ts`; API in `shared/api.ts`, types in `shared/agents.ts`.
- **Vault layout:** every vault path lives in `shared/paths.ts` (folders, entry point, rules files, context files, task files, app-owned folders, prompts); code, prompts and UI texts import it. Layout since 2026-11-22 (plain lowercase names; the old numbered folders like `05_Tasks/` are gone): `AGENTS.md` (the vault's entry point with a "What to load" table) and `CLAUDE.md` (`@AGENTS.md`), `projects/`, `workflows/` (`assistant-file-update-rules.md`, `context-maintenance.md`), `context/` (`about-me.md`, `current-priorities.md` with `## Active Priority Areas`, `goals-and-direction.md`, …), `tasks/` (`daily-todos.md`, `braindump-inbox.md`; app-owned `briefs/`, `weekly/`, `planner/`, `agent-output/`, `archive/`), `prompts/` (`daily-brief.md`, `agents/`), `decisions/`, `references/`. There is no per-vault mapping yet: a vault with the old numbered folders must be renamed to work.
- **UI:** sidebar sections Home | Organize (Today, Week, Tasks, Inbox) | Work (Chat, Agents) | Insights (Alerts, Docs, Review); ⌘1…⌘0 follow that order. Home is the old Brief page (the view id is still `brief`). Settings has subpages (General, Calendar, Engines & accounts, Data sources, Daily brief, Areas, Schedule). Review shows a due list and a short ranked Priorities panel (`components/PrioritiesPanel.tsx` reads the "priorities" list of `context/current-priorities.md`; Update context keeps that list current). Tasks can be sorted per heading (view only). Accent colour `#265537`.
- **Defaults are neutral:** `DEFAULT_PREFERENCES` (areas Work / Personal / Training, calendar placeholder "Planner") only applies when a vault has no `tasks/planner/preferences.md`. `tests/sample/preferences.ts` holds a fuller set for tests.
- **Docs for users:** `docs/agents.md`, `docs/planner.md`, `CONTRIBUTING.md`.

**Chat and agents (added 2026-11-22):**
- **Home:** the greeting varies by time of day and weekday (`src/lib/greeting.ts`: seven bands incl. late night, seeded by date so it is stable within a day). Brief cards render through a safe React Markdown renderer (ranked priority rows, checkboxes, group headings; `Md` in `Brief.tsx`). A checkbox after a number (`1. [ ] …`, how the brief writes priorities) is dropped, `[x]` strikes the row through; the Emails/attention and Suggested priorities cards show their first 4 points (`limit`; a point keeps its nested lines and the heading above it) with "Show N more"; the Due card does the same over its tasks (`DueLists`, overdue first). The "AI preparation opportunities" card and its brief section were removed (it should come back as an agent); `BRIEF_FORMAT` no longer asks for that heading, nor for "Active Task Notes" (removed 2026-11-22 with the vault's task-note files); it has five sections.
- **Chat formatting:** `src/lib/markdown.tsx` (render) + `src/lib/mdparse.ts` (pure parser, tested): tables, nested lists, checkboxes, code with Copy, `[[note]]` and relative `.md` links open in Docs. Answers split into **segments** (a heading section, or each top-level block or list item) so a part can be handed on.
- **Hand over** (`components/MessageActions.tsx`): under every agent message, per segment (hover arrow) and on selected text. Menu: other agents ranked by `shared/route.ts` `rankAgents` (word overlap, no model call, top one tagged Suggested), Add as task (QuickAdd with `initialText`), Copy. Picking an agent opens its chat with the quote in the composer (`store.handOff`, drafts per conversation, `origins`); the origin thread gets a "Sent to X ↗" note (`ChatMessage.role: 'note'`, `chatSend(agentId, text, origin)`). Also Ask again and run details.
- **Agents suggest handoffs:** conversation runs get `handoffFormat` (`agents/runner.ts`); `run-agent` and `add-task` are parsed from the answer and shown as one line under that message (`ApprovalCard compact`). `run-agent` always needs a click; an `act` agent's chat `add-task` does not (maintainer's decision, same as the existing `act` rule). Approved handoffs continue in the target's own chat.
- **Queue:** `Supervisor` persists waiting conversation turns and handoffs (`queue.json` in app data, `restore()` at start, `shutdown()` on quit keeps the file); busy agents don't refuse chat turns (cap 5 pending per agent, `MAX_PENDING`); the composer stays enabled and unanswered turns show as dashed `PendingTurn` bubbles with a stop button. Scheduled/trigger runs are not restored.
- **Handoff packet:** `AgentMessage.packet` (`HandoffPacket`: objective, input, expect, context files, origin), rendered by `renderPacket`; input over `SPILL_CHARS` (2000) is written to `tasks/agent-output/handoffs/<chainId>/` and passed as a path (the receiver always has the vault as an extra folder). `Run.chainId/hops`; `MAX_HOPS` 3 and a duplicate guard (`repeatKey` from `goals.ts`) enforced in the `run-agent` executor. The thread a handoff came from gets "X answered ↗"; the answer offers **Send back to X**. Agents → Activity groups chains with tokens and cost (`shared/chains.ts`).
- **Model dropdown:** the agent editor lists the models the account can run (`availableModels` in `engines/models.ts`: Claude fixed list, Codex's own `models_cache.json`, Ollama's server); `AgentHub.save` refuses an unavailable model.
- **Agent organization:** see the Core bullet above and `docs/agents.md` ("Agents page"). Agents view: a "Found in your agents folder" section (Import / Ignore, with a preview of what import changes), agents in named groups (`GroupPicker`, arrows to order groups), a pin per agent; the Chat sidebar lists pinned agents in their groups, plus an unpinned one while it is busy or open (`src/lib/agentGroups.ts`). `parseAgent` falls back to plain `key: value` lines when YAML fails (unquoted `: ` in a description).
- **Workspaces (2026-11-22; extended in the third session, see the handoff above):** an agent works in the conversation's folder (Chat header chip), else its `workdir` (vault-relative or absolute), else its own empty folder `workspaces/<id>/` in app data (`resolveCwd` in `agents/runner.ts`). The vault is always added next to it (`vaultDirs`: Claude/Codex `--add-dir`; the prompt names its path for engines without that flag), so agents read notes and tasks wherever they work. A CLI session belongs to its folder: when the folder changes, the next chat turn starts a new session and carries the transcript as text (`chat.cwd`). Edits outside the vault aren't reviewed.
- **Goals in parallel, peer questions (2026-11-22):** a coordinator turn's delegations run side by side (`GoalRunner.delegate`). A delegated agent may end with an `ask` block to question another agent of the goal; the peer answers, the asker finishes once (depth 1, no second ask), all inside the goal's limits; the trail shows "A asked B". No click per message: the user started the goal; chat handoffs still need one.
- **Usage log (2026-11-22):** `electron/main/metrics.ts` writes `metrics/YYYY-MM-DD.jsonl` in app data (90 days kept): `ipc` (every UI call), `state` (build times, size sampled), `startup`, `calendar`, `ui` (views), `ai` (every model call through `runEngine`: purpose, model, prompt chars, time to first output, tokens incl. cache, cost), `run` (queue wait vs run time). Names, sizes and times only: strings over 80 chars are dropped. `npm run usage-report [days] [--packaged]` summarises it. Run logs (`runs/*.jsonl`) also carry model, permission, chain, parent and `start`.
- **Protocols:** the app uses A2A's vocabulary (task states, context id, message, artifact), not its wire protocol; an MCP `propose_handoff` server and an A2A adapter are ROADMAP items. See `docs/agents.md`.
- **Not yet verified on a real vault:** an agent-proposed handoff through a real model, the long-text file spill, Send back on a real chain, the queue across a real restart, the model dropdown for Codex/Ollama on screen. Also never exercised live: Gmail OAuth, Ollama streaming, the dark theme, the first-run Setup dialog on a fresh install, completing a chosen existing folder, the Home "Get set up" checklist and the setup notice (the maintainer will test these later), importing real files written by Codex or Claude Code.

**Open items, in rough priority:**
1. **Startup setup** (ROADMAP "Startup setup: the framework every install works on"): the maintainer wants a defined framework (vault layout, shipped rules files, first-run flow) so anyone installing the app can use it. Done 2026-11-22: paths in one module (`shared/paths.ts`); plain lowercase folder names; the framework templates in `vault/framework.ts` (the vault's `AGENTS.md` and `CLAUDE.md`, both rules files, `about-me.md`, `current-priorities.md`, todo and inbox files); a folder the user chooses gets the files it lacks (`Controller.openVault(true)`); the setup check for missing files at every start; Setup's sample-agents step; the Home checklist (`components/SetupPanel.tsx`). Later: a fresh-install test (the maintainer's call), mapping other layouts (a numbered vault gets nothing and a note), the "evolve" setting with template updates for existing vaults (ROADMAP, to specify).
2. "Ask an agent" from task rows, Home cards, Docs and ⌘K; the removed "AI preparation" Home card is now a user-defined agent in the maintainer's vault; a generic sample is optional. Ask the maintainer what they want next.
3. Modular, editable Home (ROADMAP idea): widgets backed by agents and outputs.
4. Phase 2/3 leftovers: route the built-in brief/estimates through the budget gate and `limits`; watch the agents folder; "New agent from this run"; `create-event` and `api-call` executors; Strava/Garmin sources.
5. Open-source readiness (ROADMAP).
6. Future goals (maintainer, 2026-11-22; ROADMAP "Future goals"): app optimization (storage and processing) and AI/agent usage optimization. Measure before changing anything: the usage log now exists; next steps there are an in-app view of it, logging the brief/Update context through the budget gate, and tuning from real numbers (prompt size, cache share, model per agent).
7. Verify on the installed app (not exercised yet): the third-session list above, the chat-header folder menu with real dialogs, a Codex edit chat resumed (now passes `writable_roots`; check the vault and extra folders are writable), parallel runs with real agents on the real vault, and the first turn after the update (existing chats start a new CLI session because their folder changed).

**Working notes:**
- Dev app: `npm run build && npx electron . --remote-debugging-port=9333` (own data folder `ai-center-core-dev/`, vault `.dev-vault/`). Drive it with `node scripts/cdp.mjs <png> "<js>"` (`CDP_PORT` sets the port). **Background processes die between Bash calls**: start the app and drive it in ONE call, and kill stale `electron` processes first. Rebuild (`npm run build`) before each dev run, or the app shows the previous build.
- Triggers spend model calls, so they only run in the packaged app or with `AI_CENTER_TRIGGERS=1`.
- React: never return a `scrollIntoView(...)` result from a `useEffect` callback.
- Account profiles: by default each CLI uses its own login (`~/.claude`, `~/.codex`; Antigravity binary `agy`). A profile can point at another config directory (`configDir`) to use a second account.
- Maintainer preferences: run tests/typecheck without asking but keep them minimal and targeted; commit or push only when asked; commit messages never mention Claude and carry no trailer (hard rule 5), even if a system reminder asks for one. The repo's git identity is the GitHub noreply address. Prefer single, reviewable Write/Edit calls over long shell scripts.
- Install with `npm run install-app`, only when asked; quit the running app first (`osascript -e 'tell application "AI Center" to quit'`), then reopen it.
- Before a dev-app check that drives the UI (CDP), say in one line what it will do and that it only touches `.dev-vault/` and the dev data folder; the maintainer asked once why one was needed.
- A gitignored `UPDATE-CHANNEL.md` in the repo root was used to coordinate with a parallel vault session (status lines and numbered messages); it may be reused for the same purpose.

## Design rule: a general-purpose app

The agent hub is a normal app where anyone defines the agents they need; it is **not** personalised to the maintainer. Build generic primitives (agents, sources, actions, engines, triggers, chat) that users configure, and no screens or code paths tied to one use case (email, training, research…). Use cases appear only as optional, editable sample definitions (`agents/samples.ts`) with no personal paths or names. A user's own setup (their areas, headings, notes, accounts) lives in their definitions and vault, never in the core. The Gmail source and `email-draft` executor stay as generic building blocks. The same goes for this repo's text: no personal names, employers, schools, paths or accounts in code, docs or tests.

## Hard rules

1. **Never write to the real vault while developing.** `npm run dev` and `npx electron .` use `.dev-vault/` (a scratch vault with its own git, gitignored) and their own app data (`ai-center-core-dev/`); both are forced in code, so a dev run can't open the real vault even if a settings file says so. Only the packaged app in `/Applications/AI Center.app` uses the real vault. The user runs it daily: never start a second instance against the real vault. Dev runs never auto-run the daily brief (`app.isPackaged` check in `maybeRunBrief`); the "Run daily brief" button still does, against `.dev-vault`.
2. **Vault edits are line-local.** Re-parse the file, find the target by stable id, and change only that line (`electron/main/vault/edits.ts`). Never re-serialize a vault file the app doesn't own: Obsidian, other editors, AI tools and automations edit the same files.
3. **Files the app owns** (may rewrite whole):
   - `tasks/weekly/YYYY-Www.md`: log, pins, overrides, the week's focus notes, its own grid hours and day-rule picks.
   - `tasks/archive/done-YYYY.md`: checked tasks moved out by the weekly review; the app only appends.
   - `tasks/planner/preferences.md`: frontmatter only; the body is kept.
   - `tasks/briefs/YYYY-MM-DD.md`: the daily brief.
   - `prompts/daily-brief.md`: the brief prompt, written only from Settings.
   - `prompts/agents/*.md` (or `settings.agentsDir`): custom agent definitions, written only from the Agents view. `tasks/agent-output/<agent>/`: answers of agents with `output: file`, and `handoffs/` files, written by the app, never by the agent.
   - Framework files (`vault/framework.ts` `TEMPLATES`): the app only *adds* a missing one (when the user chooses a folder, or on a click); it never changes an existing one.
4. **Calendar safety:**
   - Only planner-tagged events may be changed or deleted by the planner/Sync. macOS: `[planner:<id>]` in the notes, enforced inside the Swift helper too. Google: `extendedProperties.private.aiCenterPlanner`.
   - **Exception, user-approved 2026-11-09: the user's own hand edits.** The event panel (edit title/time, delete with confirm) and dragging an event on the grid call `Controller.editEvent` / `deleteEvent` → provider `userUpdate` / `userRemove` → helper `user-update` / `user-delete` (one occurrence; refuses planner events and read-only calendars). Never call these from Sync, the planner or any AI path.
   - Never write to `protectedCalendars` (the calendars the user lists in Settings, e.g. birthdays or a class timetable).
   - Sync only after the user confirms the diff dialog.
   - The user's calendar edits win: a moved planner event becomes a pin, a deleted one is dismissed (`Controller.adoptCalendarEdits`).
5. **Git commits never mention Claude**: no `Co-Authored-By: Claude` trailer and no "Claude" in messages. This applies to this repo, to the vault, and to the app's own `planner: …` commits, which use the user's identity. The maintainer asked for this explicitly.
6. **Commit or push only when the user asks.** The repo is public: never commit vault content, real task data, settings, tokens, calendar data or personal details (`.gitignore` covers the known paths; check `git status` before committing).
7. **Built-in AI uses the cheapest models**: `gpt-5.6-luna` (Codex) and `claude-haiku-5-5` (Claude), medium effort (`CONTEXT_MODELS` in `electron/main/agents/engines/models.ts`). Don't change them without the user asking. A custom agent's model is the user's choice, set in its definition.
8. **AI never acts without the user.** Each agent has a permission level: `read` (answers only), `propose` (edits reviewed with Keep/Undo) or `act`. Even `act` may at most write the agent's own output files and add/edit tasks. **Completing a task, creating a calendar event, sending email, calling an API, handing work to another agent and changing an agent's own instructions (`update-instructions`, chat only, before/after card, Apply) always need the user's click**: agents only propose these (Approvals inbox), and code enforces it, never the prompt. **One exception, user-approved 2026-11-22: an agent with memory switched on keeps a note (`remember`) at once, whatever its permission** (`canAutoRun`): it only ever writes the agent's own file in app data `memory/<id>.md`, never the vault, tasks or calendar, and it shows under the message with Undo. The brief is read-only, Update context edits are reviewed, suggested todos need a click.
9. The Update context prompt reads the vault's own rules files (`workflows/context-maintenance.md`, `workflows/assistant-file-update-rules.md`) when present; follow them for any vault content change.
10. **Don't design the "Braindump feature"** until the maintainer specifies it (see ROADMAP).

## Where AI is used (and where it is not)

- **Daily brief** (`electron/main/context/brief.ts`)
  - **When:** the first app open of each planning day (after 04:00), or the "Run daily brief" button.
  - **How:** runs `claude -p --model claude-haiku-5-5` inside the vault with **read-only** tools: Read/Glob/Grep on the vault, plus Gmail search/get through the user's claude.ai connectors. (Codex CLI has no Gmail access.)
  - **Calendar:** only today's events from the calendars visible in the app (`hiddenCalendars` excluded) are put into the prompt; the Google Calendar connector tools are disallowed, so the brief can't read other calendars.
  - **Prompt:** the editable instructions live in the vault at `prompts/daily-brief.md` (Settings → Daily brief), with `{{date}}`, `{{calendar}}` and `{{email}}` placeholders. The fixed output format `BRIEF_FORMAT` is always appended, because the app parses its `## ` headings.
  - **Output:** the app writes `tasks/briefs/YYYY-MM-DD.md` itself. TEMPORARY INBOX suggestions are added only when the user clicks Add.
- **Update context** (⌘U, `electron/main/context/agent.ts`)
  - **How:** runs `codex exec -m gpt-5.6-luna` (default) or `claude -p --model claude-haiku-5-5`, inside the vault. Its short prompt points to the vault's `AGENTS.md` and both rules files rather than copying them; it also says to edit `daily-todos.md` one line at a time and never touch the app-owned folders. Claude is limited to file tools; Codex has no flag to disable its shell, so it runs in its `workspace-write` sandbox (writes confined to the vault, no network).
  - **Review:** the vault's text files are snapshotted first, then the user sees a per-file diff and chooses **Keep** (one commit) or **Undo**. Cancel, an error or quitting undoes it too. Undo reverts only the agent's own lines (`context/revert.ts`), so anything written to the same files since survives; a file where that can't be done with certainty is left as is and named in the toast. While a run is going, the app's own background writes wait (calendar-edit adoption, the auto brief, quick capture).
- **One-shot questions** (`electron/main/context/ask.ts`): by default `claude -p --model claude-haiku-5-5 --tools '' --strict-mcp-config`, so the model sees only the prompt text and can't read or change anything; it answers JSON. Settings → `askEngine` can switch them to Codex (`codex exec -m gpt-5.6-luna -s read-only` from an empty temp folder: no writes, no network, but its shell can't be turned off). Used for **Suggest estimates** (Tasks view) and **Plan with a wish** (Re-plan dialog). Results are shown for approval; nothing is written without a click.
- **Agents** the user defines run through `agent-hub.ts` and the supervisor under their own permission, with review and approvals as above.
- **Everything else is deterministic code, not AI:** planning, re-planning, the rest of the Brief screen, sync diff, logging, budgets, routing suggestions.

## Architecture

```
electron/main/
  index.ts              windows, ⌘⇧Space quick capture, IPC dispatch (ipcMain 'api' → Controller method, only names in API_METHODS)
  controller.ts         implements Api (shared/api.ts): vault, calendar provider, plan cache, applying calendar
                        edits, brief runs, block editing; delegates Update context to context/session.ts
  settings.ts           userData/settings.json (vault path, autoCommit, calendarProvider, OAuth client, contextEngine,
                        briefAuto/briefEmail, hiddenCalendars, eventAvailability)
  vault/                parser.ts (tasks, inbox), tokens.ts (~2h, due:/by 31/10, !high, @spread/@asap, repeat:, postpone:, 3x/week),
                        edits.ts (line patches, takeDone for the archive), service.ts (read/write/watch, brief, overrides,
                        archive, week picks/grid/notes/wishes), git.ts (batched, serialized commits with retry),
                        preferences.ts (defaults + frontmatter, migrations, dayRules), weekly.ts (log/pins/overrides/holds/notes),
                        framework.ts (shipped templates, the missing-files check), starter.ts (new vault; the controller gives it its own git history via git.ts initRepo)
  scheduler/plan.ts     pure planner (docs/planner.md "Planning rules"); variants.ts: Re-plan strategies + metrics;
                        cadence.ts: planning day (04:00 rollover) and full-vs-incremental decision; habits.ts: `3x/week`
                        → per-week sessions (ids `<task>@<week>#n`, mapped back before plan() returns); wish.ts: "Plan with
                        a wish" prompt, validation, and writing it into week overrides; day rules live inside plan.ts
  calendar/             provider.ts (interface), macos.ts (→ native/calendar-helper, Swift/EventKit),
                        google.ts (OAuth loopback), sync.ts (pure diff), adopt.ts (pure: which calendar edits win)
  agent-hub.ts          app glue: runs agents through the supervisor, review via ContextSession, executes approved actions
  agents/               core, no Electron/UI imports: definition.ts (Markdown+frontmatter), registry.ts, permissions.ts, actions.ts
                        (ApprovalStore: only approve() runs an executor), supervisor.ts (queue, parallel up to MAX_PARALLEL, budget pause, runs/*.jsonl),
                        usage.ts (window limits, budget check, run totals), runner.ts (prompts, handoff packets);
                        engines/ (types, process: spawn+stream+timeout+profile env, claude-cli, codex-cli, ollama, command,
                        models), profiles.ts (account profiles; default = each CLI's own login)
  context/              agent.ts (Update context run + vault snapshot), session.ts (Update context: snapshot, diff, Keep/Undo),
                        revert.ts (undo only the agent's lines), brief.ts (daily brief prompt + runner),
                        ask.ts (one-shot Haiku question, no tools, JSON answer: estimates, wishes)
electron/preload/       window.api.call / onState / onProgress / onBriefProgress
native/calendar-helper/ main.swift → resources/calendar-helper (npm run build:helper; bundled via electron-builder.yml)
shared/                 types.ts, api.ts (renderer↔main contract), agents.ts (agent types), time.ts, paths.ts (every vault path), categories.ts (heading → area,
                        NO_AREA), repeat.ts (repeat rules: next occurrence, earliest plannable day), route.ts (rankAgents),
                        chains.ts (group runs into handoff chains)
src/                    React 19 + Tailwind 4 + zustand
  views/                Brief (Home), Today, Week, Tasks, Alerts, Inbox, Docs, Review, Chat, Agents, Settings (+ settings/*: areas,
                        strategy, heading map, brief prompt, DayRules), Capture
  components/           TimeGrid (own grid: drag, resize, draw), BlockPanel (+ block-panel/: event editing, block tools),
                        TaskRow, RepeatPicker, NewBlock, ReplanButton (Re-plan options dialog), CalendarFilter, SyncDialog,
                        DocEditor (Milkdown), WeeklyReview (Review → "Review & plan the week"), Shutdown (Today → Wrap up),
                        EstimateSuggestions (Tasks), MessageActions (Hand over), Setup (first run), SetupPanel (vault check, Home checklist), Inline (approval/review cards),
                        ui (Button, Header, Modal, Popover in a portal, useEscape)
  lib/                  markdown.tsx + mdparse.ts (chat Markdown), greeting.ts, util.ts, taskSort.ts
tests/                  vitest: vault, scheduler, sync, brief, context, inbox, agents, markdown, routing, chains. sample/ = synthetic
                        files (committed); fixtures/ = copies of real vault files (gitignored, optional: their tests skip when absent)
scripts/cdp.mjs         screenshot / eval in the running app over the DevTools protocol (`CDP_PORT`, default 9333)
scripts/make-icon.swift app icon → build/icon.png/.icns (npm run build:icon; electron-builder picks up build/icon.icns)
scripts/sign-app.sh     signs the packaged app with a local certificate (see "Packaging")
```

Data flow: the main process computes `AppState` (vault + calendar + plan + brief status + agents) and pushes it on every change (`state` channel). The renderer calls `api.<method>()` and never touches files. To add a call, put the method in `shared/api.ts` (and `API_METHODS`) and implement it on `Controller`; the preload proxy needs no change.

**App data** (`~/Library/Application Support/AI Center Planner/`, kept from before the rename; dev: `ai-center-core-dev/`; both set in `electron/main/index.ts`; dev always uses `.dev-vault` even if a settings file says otherwise):
- `settings.json`
- `plan-cache.json`: last plan, so blocks stay stable across restarts.
- `sync-state.json`: what was synced, plus dismissals from calendar deletions.
- `seen-tasks.json`: task ids the app created or the user reviewed; any other open task is "new in your todo list" (Inbox). Seeded with everything on first run.
- `google-tokens.bin`: Keychain-encrypted.
- `metrics/` (usage log), `workspaces/<agent>/` (default working folders).
- Agents: `agents-org.json` (per agents folder: accepted, ignored, groups, pins), `chats/` (transcripts), `runs/` (JSON-lines logs), `approvals.json`, `goals/`, `queue.json` (waiting turns), `limits.json`, `triggers.json`.

## Conventions

- TypeScript strict, matching the existing style: no semicolons, single quotes, 2 spaces, long lines, terse comments that explain *why*. There is no Prettier config: **don't run Prettier with defaults** (it rewrites whole files with semicolons and double quotes). Edit by hand.
- Times are local. Planner timestamps are `YYYY-MM-DDTHH:mm:00` without an offset (`localISO`); calendars return offsets, so compare via `Date`. Never `new Date('YYYY-MM-DD')` (it parses as UTC): use `parseDate` from `shared/time.ts`.
- Vault paths only come from `shared/paths.ts`; never write a folder or file name as a literal elsewhere. Prompts the app sends point to vault files rather than pasting them, and stay short.
- Our own UI primitives (`components/ui.tsx`); no component libraries. The docs editor is Milkdown Crepe.
- New planner rules: add the field to `Preferences` (types + `DEFAULT_PREFERENCES` + `parsePreferences` merge), a Settings control, a test, and a line in docs/planner.md "Planning rules".
- Test files that import code from `src/` must import `.ts` modules (the node tsconfig has no JSX): put pure logic in `.ts` files (like `mdparse.ts`) and keep `.tsx` for rendering.

## Verify your changes

```bash
npm test              # 293 tests; must stay green (2 skip on a fresh clone without tests/fixtures/)
npm run typecheck
npm run build && npx electron . --remote-debugging-port=9333 &   # runs against .dev-vault
node scripts/cdp.mjs /tmp/shot.png "document.body.innerText.slice(0,300)"   # screenshot + eval in renderer
#   main-process calls from the renderer: window.api.call('<method>', ...args)
cd .dev-vault && git status && git log --oneline | head   # confirm exactly what the app wrote
npm run install-app   # build helper + package + sign + copy to /Applications (real vault at runtime; ask the user to restart the app)
npm run sign          # scripts/sign-app.sh: signs dist with a local certificate so macOS keeps Calendar access
                      #   across rebuilds. Warns and exits 0 if the certificate is missing.
```

macOS `screencapture` is blocked in agent sandboxes; use `scripts/cdp.mjs`. The calendar permission prompt needs the user's click: test calendar features in the packaged app with the user. CDP can't drive HTML5 drag and drop.

## Feature notes and gotchas

Engineering knowledge worth keeping from earlier work, without the session history.

- **Subtasks inherit timing.** A subtask without its own `due:` / `@spread` / `@asap` takes its nearest ancestor's, flagged `dueFromParent` / `timingFromParent` (never written to the line; repeating tasks and habits keep their own `due`). The planner shares one even daily amount between spread leaf subtasks under the same root task (`shares` in `plan.ts`), filled in queue order. Tasks under a heading mapped to no area only get leftover time, where spread doesn't apply.
- **Checking off a repeating task.** Task ids are `file|heading|title#n` (n counts same-titled tasks in order), so the next occurrence must not be inserted above the checked line or it would take over its id. `patchTask` (`vault/edits.ts`) inserts it below the task's subtree; unchecking right after removes that copy again, only if it is still byte-identical to what check-off wrote. The new copy is marked seen (`onOwnTaskIds`) so it isn't "new in your todo list".
- **Skipping one occurrence.** In Today the trash on a repeating task calls `Controller.skipOccurrence` (moves `due:` to `nextOccurrence`, clears `postpone:`, never writes `[x]` or a log entry); the Tasks view still deletes the series. `nextOccurrence` is a *catch-up* repeater (org-mode `++`); counting from the completion date is a ROADMAP idea.
- **Single-day sync.** `buildSyncDiff(..., day?)` narrows the window to one local day, `syncPreview(day?)` passes it, `syncApply` is unchanged. A day diff only touches planner events inside that day. Build the window with `parseDate(day)`; a test fails if someone reintroduces `new Date(day)`.
- **macOS Calendar pulls web edits.** EventKit reads the local Calendar database, which may not fetch from Google until Calendar.app runs. The helper command `refresh [seconds]` calls `refreshSourcesIfNecessary()` and waits for `EKEventStoreChanged`; `Controller.pullRemote` runs it after each refresh (focus, 10-minute timer, at most every 30 s) and `syncPreview` awaits it. The dev helper has no Calendar access, so this is only typechecked there.
- **Drag to reorder** in Tasks: `reorderTask` (`vault/edits.ts`) moves only the dragged task's subtree before/after the target, refusing moves across a different parent or section. `TaskRow` takes `onReorder` (only Tasks passes it) and `skipRepeats` (only Today passes it).
- **Small windows:** min window 640×480; container queries on `<main>`; icon sidebar under 900 px (84 px wide; the macOS window buttons are pinned at x 12 via `trafficLightPosition`, so change both together); Today's list is a drawer and BlockPanel an overlay when narrow; popovers render in a portal and flip.
- **Data safety:** Update context undo reverts only the agent's lines; an offline calendar doesn't dismiss synced blocks; IPC only accepts `API_METHODS`; git commits are serialized with retry and a visible error.
- **Priorities:** `!urgent` > `!high` > medium > low; the flag chip cycles them and updates at once in the UI. Block panel checkboxes save immediately (task done and, once the block has started, the block log).
- **Packaging and signing:** the bundle is signed by `scripts/sign-app.sh` (nested code bottom-up, then the bundle) with a self-signed Code Signing certificate in the login keychain (default name "AI Center Dev", override with `AI_CENTER_SIGN_IDENTITY`). Without a stable identity the code hash changes on every build and macOS asks for Calendar access again. It signs with the certificate's SHA-1 hash, not its name (a self-signed root is hidden from `security find-identity -v`). A missing certificate warns and exits 0; an expired one fails the build. Changing the identity resets the macOS permission once. Not an Apple Developer ID, so first launch may need right-click → Open.
- **Codex for one-shot questions** (`Settings.askEngine`): runs read-only from an empty temp dir and reads `-o last.txt`; UI texts name the chosen engine via `askerName` (`src/lib/util.ts`).
