# Contributing

- `npm ci`, then `npm run dev` (uses a scratch vault, `.dev-vault/`, and its own data folder; it never touches your real vault).
- `npm test` and `npm run typecheck` must stay green.
- Style: TypeScript strict, no semicolons, single quotes, two spaces. There is no Prettier config: don't run Prettier with its defaults.
- The agent core under `electron/main/agents/` must not import Electron or UI code, so it can run headless later. App glue lives next to it (`agent-hub.ts`).
- Keep it general-purpose: add generic building blocks (engines, sources, actions, triggers), not features for one use case. Use cases belong in optional sample agents.
- Safety rules are part of the design: agents only propose outside effects, the user approves them, and vault edits are line-local. Read `AGENTS.md` ("Hard rules") before changing anything that writes files or calendars.
- Never commit vault content, tokens or personal data.
