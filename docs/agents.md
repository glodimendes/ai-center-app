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
workdir: projects     # optional folder inside the vault
budget: 60               # optional: pause when the account's window is at 60%
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
- **Central:** coordinate several agents. Tag agents with `@` (autocomplete as you type) to give them work directly; each answers in the thread under its name. A message with no tag goes to a coordinator agent (the Coordinator example, or any read-only agent named like one), which splits it between your other agents and writes the final answer.

Answers render tables, nested and checkbox lists, code (with a copy button) and links: `[[note]]` or a relative `.md` path opens in Docs.

**Handing work on.** Hover an answer: **Hand over** (under it) offers every other agent, best fit first (marked *Suggested*, by plain word overlap with the agents' names and descriptions; no model call), plus **Add as task…** and **Copy**. Each section or top-level list item has its own arrow, and selected text offers **Hand over selection**, so one answer can be split between agents. Choosing an agent opens its chat with the part quoted in the message box for you to edit and send; the original conversation gets a "Sent to …" line that links to it. **Ask again** re-sends the question and the info button shows what the run did.

In a conversation an agent may also propose a handoff or a task itself; it appears as one line under its answer (→ Agent, Dismiss / Send) and nothing happens until you click. Approved handoffs continue in the target agent's own chat. (An agent with permission `act` adds a task it proposes in chat without a click, as everywhere else; a handoff always needs one.)

**Waiting turns.** An agent works on one thing at a time. A message or handoff sent while it is busy waits in the queue instead of failing: it shows in the chat as a dashed bubble ("Waiting · 2 ahead", with a stop button), runs when its turn comes, and is kept if you quit the app (up to 5 waiting messages per agent). Runs started by a schedule are not kept.

**What a handoff carries.** An agent-proposed handoff is a small packet: the *objective*, the *material*, the *form of the answer* and, for long material, a vault file in `tasks/agent-output/handoffs/` that the receiver reads first. The receiver sees nothing of the sender's conversation. A chain stops after 3 handoffs in a row, and the same ask is never sent twice in one chain. When the receiver is done, the thread it came from gets "<Agent> answered ↗", and its answer offers **Send back to <Agent>**, which quotes it into your chat with the sender for you to edit and send. Agents → Activity groups a chain with its total tokens and cost.

**How this relates to other agent protocols.** The open standard for agents talking across systems is A2A (Agent2Agent, Linux Foundation; IBM's ACP merged into it). It is a network protocol between separately hosted agents, which this local app doesn't need, so the app borrows its vocabulary instead: a run is a task (queued = submitted, running = working, paused = input-required, done = completed, error = failed, cancelled = canceled), a chain id plays the part of its context id, a handoff packet is its message, and an output file is its artifact. MCP is the sibling protocol for tools.

Each message is a normal run: it queues, respects the usage ceiling and your review. Things an agent wants to do (add a task, save a draft, hand work on…) appear as cards in the conversation for you to approve or reject, and a paused run or a file edit waiting for review shows up the same way.

## Agents page

**Agents** lists your agents (edit, or jump to a chat) and the built-in ones. **Activity** shows what is waiting for you, your goals and the recent runs with their usage.

**Only agents made or accepted in the app count.** Other tools (Codex, Claude Code, Claude Desktop, a script) may write files into the agents folder too. Such a file isn't an agent until you accept it: it doesn't run, chat, react to triggers or receive handoffs. It appears under **Found in your agents folder** with a preview of how it would be imported:
- A file in the app's format, or a Claude Code subagent with a valid file name, is imported as it is; the file isn't changed.
- Anything else (a Codex prompt, a file without frontmatter, a name like `Review PR.md`) is saved as a new file in the app's format, and the original stays where it is, hidden.
- Fields other tools use (tool lists, argument hints, colours) are named and ignored: what an agent may do always comes from its permission in the app, read-only unless the file says otherwise in the app's format. `model: inherit` means the account's default; `$ARGUMENTS` isn't filled in, your message follows the instructions instead.

**Ignore** hides a file; the ignored list at the bottom brings it back. Agents that were in the folder when this was introduced count as accepted.

**Groups and pins.** Put each agent in a group you name (the group picker on its row; groups you no longer use disappear) and order groups with the arrows. The pin decides whether an agent is listed in the Chat sidebar; an unpinned agent's chat is still one click away from the Agents page, and it shows in the sidebar while it's working or open. New, sample and imported agents start pinned. This organization is kept in the app (`agents-org.json` in its data folder), not in the agent files.

## Goals

A **goal** is how the coordinator works: it either delegates steps to your other agents or gives the final answer. Every delegated run is a normal run: it uses its own agent's permission, respects the usage ceiling, and anything it proposes waits for your approval. Limits are enforced by the app (8 turns, 12 delegations; a repeated request stops the goal and asks you). The plan, each agent's output and the result are saved as files under `tasks/agent-output/goals/<goal>/`. Start one from Activity, or just write an untagged message in Central.
