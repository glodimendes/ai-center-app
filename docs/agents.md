# Agents

AI Center lets you define your own agents. An agent is a Markdown file; the app runs it on an AI command-line tool you already use and keeps you in control of everything it does.

## An agent file

Agents live in `06_Prompts/agents/` of your vault (or the folder set in Settings). One file each:

```markdown
---
name: Weekly summary
profile: claude          # an account profile (Settings → Engines & accounts)
permission: read         # read | propose | act
output: file             # reply | file | suggestions | actions
triggers: [manual, "schedule: 17:00"]
sources: [project-notes] # ids from Settings → Data sources
model: claude-sonnet-5-5 # optional; empty = the profile's or the cheap default
workdir: 02_Projects     # optional folder inside the vault
budget: 60               # optional: pause when the account's window is at 60%
---

Summarise what changed in my notes this week, in five bullets.
```

You can also create and edit agents in the **Agents** view.

## Permissions

| Permission | What it can do |
|---|---|
| `read` | Read files in its folder and answer. Changes nothing. |
| `propose` | Edit files. You see a diff and choose **Keep** or **Undo**; nothing stays without Keep. |
| `act` | Like `propose`, and adds tasks without asking. |

Whatever the permission, anything with an effect outside the agent's own output **always needs your click** in the Approvals inbox: completing a task, creating a calendar event, saving an email draft, calling an API, handing work to another agent, creating a new agent. The app enforces this in code; it never relies on the prompt.

## Output

- `reply`: the answer is shown in the run history.
- `file`: the app saves the answer under `05_Tasks/agent-output/<agent>/`.
- `suggestions` / `actions`: the agent ends with an `actions` block (`add-task`, `complete-task`, `create-event`, `email-draft`, `api-call`, `run-agent`, `new-agent`); each becomes a card you approve or reject.

## Triggers

`manual` (Run now, chat, or `@agent message` in quick capture), `schedule: HH:MM` (runs once a day after that time, with catch-up if the app was closed), `on-open` (once per day, the first time you open the app after 04:00), `file-watch: <glob>` (when a matching vault file changes outside the app). Triggers run while the app is open.

## Data sources

Defined once in Settings → Data sources and referenced by id: a vault file or folder, a file on your Mac, a web address, or Gmail (read mail, create drafts; nothing is ever sent). The text is given to the agent as read-only data.

## Accounts and engines

An **account profile** is one login of one tool. Built in: Claude Code, Codex, Antigravity (`agy`), local models through Ollama (text only), and a custom command (any program that takes a prompt and prints an answer). Use several profiles side by side, for example two Claude logins. For Claude and Codex the app reads your 5-hour and weekly usage and pauses agents when an account reaches the ceiling you set (default 70%), asking whether to allow once, raise the ceiling or skip.

## Chat

**Chat** in the Agents view continues a conversation with an agent across messages (Claude, Codex and Antigravity). Each message is a normal run: it queues, respects the usage ceiling and your review.

## Goals

A **goal** lets one agent coordinate the others. Add the Coordinator sample (or any agent with `read` permission), open **Goals** in the Agents view and describe what you want. Each turn the coordinator either delegates steps to your other agents or gives the final answer. Every delegated run is a normal run: it uses its own agent's permission, respects the usage ceiling, and anything it proposes waits in the Approvals inbox. Limits are enforced by the app (8 turns, 12 delegations; a repeated request stops the goal and asks you). The plan, each agent's output and the result are saved as files under `05_Tasks/agent-output/goals/<goal>/`.
