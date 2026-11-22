# Agents

AI Center lets you define your own agents. An agent is a Markdown file; the app runs it on an AI command-line tool you already use and keeps you in control of everything it does.

## An agent file

Agents live in `prompts/agents/` of your vault (or the folder set in Settings). One file each:

```markdown
---
name: Weekly summary
profile: claude          # an account profile (Settings → Engines & accounts)
permission: read         # read | propose | act
output: file             # reply | file | suggestions | actions
triggers: [manual, "schedule: 17:00"]
sources: [project-notes] # ids from Settings → Data sources
model: claude-sonnet-5-5 # optional; empty = the profile's or the cheap default
workdir: projects     # optional: a folder in the vault or any folder on your Mac; default: the agent's own workspace
budget: 60               # optional: pause when the account's window is at 60%
folders: [references]    # optional: more folders it may use (vault-relative or absolute); the vault is always added
memory: true             # optional: keeps notes between runs (see "Memory" below)
---

Summarise what changed in my notes this week, in five bullets.
```

You can also create and edit agents in the **Agents** view. There the model is a dropdown of the models the account can run (Claude's list, Codex's own list, whatever your Ollama server has); a model the account can't run is refused when saving.

## Permissions

| Permission | What it can do |
|---|---|
| `read` | Read files in its folder and answer. Changes nothing. |
| `propose` | Edit files. You see a diff and choose **Keep** or **Undo**; nothing stays without Keep. |
| `act` | Like `propose`, and adds tasks without asking. |

Whatever the permission, anything with an effect outside the agent's own output **always needs your click** in the Approvals inbox: completing a task, creating a calendar event, saving an email draft, calling an API, handing work to another agent, creating a new agent. The app enforces this in code; it never relies on the prompt.

## Output

- `reply`: the answer is shown in the run history.
- `file`: the app saves the answer under `tasks/agent-output/<agent>/`.
- `suggestions` / `actions`: the agent ends with an `actions` block (`add-task`, `complete-task`, `create-event`, `email-draft`, `api-call`, `run-agent`, `new-agent`); each becomes a card you approve or reject.

## Triggers

`manual` (Run now, chat, or `@agent message` in quick capture), `schedule: HH:MM` (runs once a day after that time, with catch-up if the app was closed), `on-open` (once per day, the first time you open the app after 04:00), `file-watch: <glob>` (when a matching vault file changes outside the app). Triggers run while the app is open.

## Data sources

Defined once in Settings → Data sources and referenced by id: a vault file or folder, a file on your Mac, a web address, or Gmail (read mail, create drafts; nothing is ever sent). The text is given to the agent as read-only data.

## Accounts and engines

An **account profile** is one login of one tool. Built in: Claude Code, Codex, Antigravity (`agy`), local models through Ollama (text only), and a custom command (any program that takes a prompt and prints an answer). Use several profiles side by side, for example two Claude logins. For Claude and Codex the app reads your 5-hour and weekly usage and pauses agents when an account reaches the ceiling you set (default 70%), asking whether to allow once, raise the ceiling or skip.

## Chat

The **Chat** page has a conversation list on the left: **Central** and one entry per agent.

- **One agent:** a direct conversation that remembers earlier messages until you start a new one (Claude, Codex and Antigravity keep a real session; other engines are sent the recent transcript).
- **Central:** coordinate several agents. Refer to agents with `/` (autocomplete as you type, e.g. `/writer draft this`) to give them work directly; each answers in the thread under its name. A message with no tag goes to a coordinator agent (the Coordinator example, or any read-only agent named like one), which splits it between your other agents and writes the final answer.

- **Model and effort:** the pill left of Send picks the account, model and effort for this conversation, from every account you have. The agent's own settings (Agents → edit → Model, Effort) are the default; **New chat** returns to them. Changing the model keeps the session; changing the account starts a new one and carries the transcript as text.
- **Live answers:** the answer appears as the agent writes it (Claude by message, Codex by message, Ollama as it types) and is replaced by the final message when the run ends. Stop cancels it.
- **Files:** the paperclip, dragging files onto the box, pasting an image, or typing `@` and choosing a file from the conversation's folders and the vault.
- **Referring to agents:** `/` lists your agents. In Central it sends the message to that agent. In an agent's chat it tells the agent you mean the other one, and it may propose handing the work over (your click decides).
- **Folders:** the folder chip in the header shows where the agent works and saves, the other folders it may use and the vault. Change the main folder, add folders for this conversation, or save them as the agent's default. Files stay where they are (a pasted image is kept in the app's data folder); the agent is told their paths, and engines that can't open files (Ollama, a custom command) get text files inline.

Answers render tables, nested and checkbox lists, code (with a copy button) and links: `[[note]]` or a relative `.md` path opens in Docs.

**Handing work on.** Hover an answer: **Hand over** (under it) offers every other agent, best fit first (marked *Suggested*, by plain word overlap with the agents' names and descriptions; no model call), plus **Add as task…** and **Copy**. Each section or top-level list item has its own arrow, and selected text offers **Hand over selection**, so one answer can be split between agents. Choosing an agent opens its chat with the part quoted in the message box for you to edit and send; the original conversation gets a "Sent to …" line that links to it. **Ask again** re-sends the question and the info button shows what the run did.

In a conversation an agent may also propose a handoff or a task itself; it appears as one line under its answer (→ Agent, Dismiss / Send) and nothing happens until you click. Approved handoffs continue in the target agent's own chat. (An agent with permission `act` adds a task it proposes in chat without a click, as everywhere else; a handoff always needs one.)

**Waiting turns.** An agent works on one thing at a time. A message or handoff sent while it is busy waits in the queue instead of failing: it shows in the chat as a dashed bubble ("Waiting · 2 ahead", with a stop button), runs when its turn comes, and is kept if you quit the app (up to 5 waiting messages per agent). Runs started by a schedule are not kept.

**What a handoff carries.** An agent-proposed handoff is a small packet: the *objective*, the *material*, the *form of the answer* and, for long material, a vault file in `tasks/agent-output/handoffs/` that the receiver reads first. The receiver sees nothing of the sender's conversation. A chain stops after 3 handoffs in a row, and the same ask is never sent twice in one chain. When the receiver is done, the thread it came from gets "<Agent> answered ↗", and its answer offers **Send back to <Agent>**, which quotes it into your chat with the sender for you to edit and send. Agents → Activity groups a chain with its total tokens and cost.

**How this relates to other agent protocols.** The open standard for agents talking across systems is A2A (Agent2Agent, Linux Foundation; IBM's ACP merged into it). It is a network protocol between separately hosted agents, which this local app doesn't need, so the app borrows its vocabulary instead: a run is a task (queued = submitted, running = working, paused = input-required, done = completed, error = failed, cancelled = canceled), a chain id plays the part of its context id, a handoff packet is its message, and an output file is its artifact. MCP is the sibling protocol for tools.

Each message is a normal run: it queues, respects the usage ceiling and your review. Things an agent wants to do (add a task, save a draft, hand work on…) appear as cards in the conversation for you to approve or reject, and a paused run or a file edit waiting for review shows up the same way.

## Agents page

**Agents** lists your agents (edit, or jump to a chat) and the built-in ones. **Activity** shows what is waiting for you, your goals, what agents cost and the recent runs with their usage.

**History survives a restart.** Recent runs are rebuilt from the run logs when the app starts, so a scheduled agent's answer is still there the next day. A run that was cut off by quitting shows as interrupted.

**Notifications.** While the app is in the background you get a system notification (and a dock badge for what waits for you) when a run fails, pauses on the usage ceiling, wants your OK, changed files to review, or a goal needs you. They name the agent and say what happened, never the answer. Settings → General switches them off.

**Cost.** Activity → Cost shows, per agent, what it used today, in 7 and in 30 days, with a bar per day for the last two weeks. Figures are what the CLIs report (the API-equivalent price for Claude; Codex reports tokens only), not your subscription bill; only finished runs count.

**Memory.** Switch on "Remember things between runs" in an agent's settings and it can keep notes (preferences, decisions, facts you told it). While it works (in a chat or a run) it decides what is worth keeping and ends its answer with a note. The note is kept at once, whatever the agent's permission (it only writes the agent's own memory file, never your vault, tasks or calendar), and shows under the answer as "Remembered · … Undo". In an agent's chat the **Memory** button in the header switches memory on, shows the notes and lets you edit or clear them (the same field is in the agent's settings). The notes live in the app's data folder (`memory/<agent>.md`) and are shown to the agent at the start of each run (the newest ~4000 characters). Deleting the agent deletes its notes.

**Adapting an agent from its chat.** If you tell an agent how it should work from now on ("always answer in bullet points"), it may propose new instructions. They appear under its answer as a before/after card and change nothing until you click **Apply**; the chat then continues in a new session that has the new instructions. A small preference is better as a note, which the agent chooses on its own. Built-in agents can't be changed this way.

**Only agents made or accepted in the app count.** Other tools (Codex, Claude Code, Claude Desktop, a script) may write files into the agents folder too. Such a file isn't an agent until you accept it: it doesn't run, chat, react to triggers or receive handoffs. It appears under **Found in your agents folder** with a preview of how it would be imported:
- A file in the app's format, or a Claude Code subagent with a valid file name, is imported as it is; the file isn't changed.
- Anything else (a Codex prompt, a file without frontmatter, a name like `Review PR.md`) is saved as a new file in the app's format, and the original stays where it is, hidden.
- Fields other tools use (tool lists, argument hints, colours) are named and ignored: what an agent may do always comes from its permission in the app, read-only unless the file says otherwise in the app's format. `model: inherit` means the account's default; `$ARGUMENTS` isn't filled in, your message follows the instructions instead.

**Ignore** hides a file; the ignored list at the bottom brings it back. Agents that were in the folder when this was introduced count as accepted.

**Groups and pins.** Put each agent in a group you name (the group picker on its row; groups you no longer use disappear) and order groups with the arrows. The pin decides whether an agent is listed in the Chat sidebar; an unpinned agent's chat is still one click away from the Agents page, and it shows in the sidebar while it's working or open. New, sample and imported agents start pinned. This organization is kept in the app (`agents-org.json` in its data folder), not in the agent files.

## Working folders

Each agent works in its own empty workspace (kept in the app's data folder) unless you give it a **main folder**: where it works and saves its files. In its settings, **Folders** also takes more folders it may use (`folders:` in the file); the vault is always added. Any folder works, in the vault (like `projects`) or on your Mac; one conversation can use another main folder (the folder chip in the chat header, cleared by New chat). The vault is always readable too, wherever the agent works. Edits an agent makes inside the vault are reviewed as before; edits in another folder you chose are not.

## Several agents at once

Up to three agents run at the same time. An agent never runs twice at once, and an agent that may edit (`propose`, `act`) runs alone so its review shows only its own changes. In a goal, the delegations of one turn run side by side.

## Goals

A **goal** is how the coordinator works: it either delegates steps to your other agents or gives the final answer. Every delegated run is a normal run: it uses its own agent's permission, respects the usage ceiling, and anything it proposes waits for your approval. Limits are enforced by the app (8 turns, 12 delegations; a repeated request stops the goal and asks you). A delegated agent may also question another agent of the goal (one round, answers come back once); this needs no click because you started the goal, and the goal shows who asked whom. The plan, each agent's output and the result are saved as files under `tasks/agent-output/goals/<goal>/`. Start one from Activity, or just write an untagged message in Central.


A finished, stopped or failed goal can be run again as it was, or edited first (**Run again**, **Edit and run**). **Continue** picks a goal up after a limit, a suspected loop, a stop or an error, with a fresh budget of turns and delegations. The goal's plan, each agent's output and the result are files in the vault; the link under the goal shows them.

## Usage log

The app keeps a local log of how it is used and how fast it runs (`metrics/` in its data folder, 90 days): calls from the screens, state build times, startup, screens opened, every model call (purpose, model, prompt size, time, tokens including cached ones, cost) and each agent run's queue wait and run time. It holds names, sizes and times only, never text, and never leaves your Mac. `npm run usage-report` summarises it.
