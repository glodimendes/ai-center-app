# AI Center

A macOS desktop app that plans your week from a folder of plain Markdown notes and your calendar, and lets you define your own AI agents that work on the same notes. Nothing leaves your machine except what you connect yourself (a calendar, Gmail, the AI tools you already use), and nothing acts without your click.

- **A planner you can read.** Your tasks are lines in a Markdown file (`- [ ] Read the paper ~2h due:2026-12-01 !high`). The app turns them into a day-by-day plan with blocks on a timeline, around your calendar events, working hours, daily limits and deadlines. The planning is ordinary code, not AI, so it is predictable and explainable.
- **Your calendar stays yours.** It reads macOS Calendar (which can include your Google calendars) or Google directly, and writes only the events it created itself, after you confirm a preview of every change.
- **Agents you define.** An agent is a Markdown file: instructions, a permission level, the data it may read and how it runs. Chat with them one at a time or all together, hand part of an answer to another agent, queue work for a busy one, and approve everything that has an effect outside the agent's own answer.
- **Local and inspectable.** Your notes are files (an Obsidian vault works as is), every change the app makes is a small git commit you can undo, and AI edits are shown as a diff you keep or undo.

> Status: version 0.1, a personal project that runs daily for its author on macOS; expect rough edges. Open source under the [MIT license](LICENSE).

## What it looks like in use

| | |
|---|---|
| **Home** | A greeting, today's timeline, planned hours per area, deadlines, and an optional AI-written daily brief. Until you are set up, a short checklist of what is left. |
| **Today / Week** | The plan as blocks on a timeline. Drag tasks onto time, resize blocks, log what you actually did, re-plan with a sentence ("keep Friday afternoon free"). |
| **Tasks / Inbox** | Your task file as an editable list; a quick-capture shortcut (⌘⇧Space) for raw thoughts. |
| **Chat** | A central conversation (tag agents with `@`) and one conversation per agent. Answers render tables and lists; **Hand over** sends a whole answer, one section or a selection to another agent, with a suggested best fit. |
| **Agents** | Create and edit agents, add examples (a coordinator, a task automator, a routine coach, an email triager), see what is running, waiting and what it cost. |
| **Docs / Review** | A Markdown editor for your notes; planned versus actual time and a weekly review. |

The planner is documented screen by screen in [docs/planner.md](docs/planner.md), and agents in [docs/agents.md](docs/agents.md).

## Requirements

- A Mac with Apple Silicon. The install script builds an arm64 app.
- [Node.js](https://nodejs.org) and npm, a recent version (developed on Node 24).
- Xcode Command Line Tools (`xcode-select --install`), used to compile the small Swift helper that talks to macOS Calendar. They include git, which keeps your notes' history; set your name and email once (`git config --global user.name …` and `user.email …`) so the app can commit.
- Optional, for AI features: the command-line tools of the services you already use. Agents can run on [Claude Code](https://claude.com/claude-code) (`claude`), Codex (`codex`), Antigravity (`agy`), a local [Ollama](https://ollama.com) model, or any command that reads a prompt and prints text. Sign in to each CLI yourself; the app never asks for your password. The planner works without any of them.

## Install

There is no prebuilt download yet, so build it from source:

```bash
git clone https://github.com/glodimendes/ai-center-app.git
cd ai-center-app
npm ci
npm run install-app
```

`install-app` compiles the Calendar helper, builds and packages the app, signs it, and copies it to `/Applications/AI Center.app`. Open it from there; quitting it leaves nothing running.

**First launch**

1. macOS may say the app is from an unidentified developer, because it is not notarized. Right-click the app and choose **Open** once.
2. A setup dialog covers four choices:
   - **Your notes folder.** Accept the starter vault the app creates (with example tasks and its own git history), or choose a folder you already have, such as an Obsidian vault. A chosen folder gets the framework files it lacks (see [the vault](#your-notes-folder-the-vault)); nothing you wrote is changed.
   - **AI tools.** Which command-line tools were found, and how to install the missing ones.
   - **Calendar.** macOS Calendar or Google Calendar.
   - **Sample agents.** Optional ready-made agents, added as files you can edit or delete.
3. Home then shows a **Get set up** checklist with a button for each open step: connect the calendar, set your areas, run the first sync, add a first agent. Choose which calendars the app reads and which one it writes planner blocks to in **Settings → Calendar** (the default is a placeholder calendar called "Planner", so pick yours before the first sync).
4. In **Settings → Engines & accounts**, **Test** on an account runs one tiny request to check that it works.

**About signing.** `install-app` signs the app with a local self-signed certificate named "AI Center Dev" if you have one in your login keychain, so that macOS keeps the Calendar permission across rebuilds. Without that certificate it still builds, with a warning, but macOS will ask for Calendar access again after every rebuild. `scripts/sign-app.sh` explains how to create the certificate.

**Updating.** Pull, run `npm ci` if dependencies changed, then `npm run install-app` again and restart the app. Your notes and settings are untouched.

**Just trying it.** `npm run dev` runs a hot-reloading copy against a scratch vault in `.dev-vault/` with its own data folder; on a fresh clone the app creates it as a starter vault. It never opens your real notes, so it is safe to experiment with.

## Your notes folder (the vault)

Everything the app uses is a plain file in one folder. A new vault starts with this layout:

```
AGENTS.md                    entry point for AI tools: what to load for which task (CLAUDE.md points to it)
projects/                    one note per project
workflows/                   the rules every AI follows: assistant-file-update-rules.md, context-maintenance.md
context/                     about-me.md, current-priorities.md ("## Active Priority Areas", shown in Review), other context
tasks/daily-todos.md         your tasks (headings are areas, "- [ ]" lines are tasks)
tasks/braindump-inbox.md     quick captures
tasks/briefs/ weekly/ planner/ agent-output/ archive/
                             written by the app: daily briefs, weekly logs, planner settings, agent answers, done tasks
prompts/daily-brief.md       the daily brief's instructions (edited in Settings)
prompts/agents/              one Markdown file per agent
```

`decisions/` and `references/` are optional. AI tools may read the app's folders but never edit them; the rules files say so.

A new vault gets its own git history right away, so every change the app makes can be undone. If you choose a folder you already have, the app adds the files from this list that it lacks and changes nothing you wrote. It checks this at every start, so after every update: Settings → General → Vault setup lists anything missing, which you add with a click. A folder in another layout, such as numbered folders like `05_Tasks/`, isn't mapped yet; nothing is added to it. Until setup is complete, Home shows a short checklist (vault, AI tool, calendar, areas, first sync, first agent).

The app edits single lines, found again by task id, so you can keep editing the same files in Obsidian or any editor at the same time. By default each change is committed to the folder's own git history ("auto-commit" can be turned off in Settings).

A task line can carry optional details: `~2h` estimate, `due:2026-12-01` or `by 1/12`, `!urgent` `!high` `!low`, `@spread` or `@asap`, `repeat:weekly`, `postpone:2026-12-05`, `3x/week`. The full syntax and every planning rule are in [docs/planner.md](docs/planner.md).

## AI and safety

- **The planner is not AI.** AI is used in three places only: the optional daily brief, "Suggest estimates" and "Plan with a wish", and "Update context" (⌘U), plus the agents you create. The built-in ones use the cheapest models of the service you pick.
- **Agents never act on their own.** Each agent has a permission: `read` (answers only), `propose` (edits files, which you review as a diff and keep or undo) or `act` (may also add tasks). Completing a task, creating a calendar event, saving an email draft, calling an API and handing work to another agent always wait for your click. Code enforces this, not the prompt.
- **Gmail is draft-only.** If you connect it, agents can read mail and save drafts; there is no code path that sends.
- **Calendar safety.** Only events the app created (tagged) are changed or deleted. Calendars you mark as protected are never written. Sync shows every add, move and removal first.
- **Usage limits.** Agents pause and ask before they would use more than a set share of an account's 5-hour or weekly window.

## Develop

```bash
npm ci
npm run dev          # hot reload against .dev-vault (never your real vault)
npm test             # unit tests
npm run typecheck
npm run build:helper # compile the macOS Calendar helper
npm run install-app  # build, package, sign, copy to /Applications
```

Stack: Electron, electron-vite, React 19, Tailwind 4, zustand, Milkdown, vitest. The app's main process lives in `electron/main/` (the agent core in `electron/main/agents/` has no Electron imports), the interface in `src/`, shared types in `shared/`, the Swift calendar helper in `native/`.

## Contributing

Issues and ideas are welcome. Before changing anything, read [CONTRIBUTING.md](CONTRIBUTING.md) and the hard rules in [AGENTS.md](AGENTS.md); it is also the starting point if you work on the code with an AI assistant. Open decisions and next steps are in [ROADMAP.md](ROADMAP.md).

## License

[MIT](LICENSE). Contributions are accepted under the same license.
