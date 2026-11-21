/** Cheapest models, chosen by the user for cost. Effort applies to this run only, not the global CLI config. Built-ins use these; a custom agent may choose its own. */
export const CONTEXT_MODELS = {
  codex: { model: 'gpt-5.6-luna', effort: 'medium' },
  claude: { model: 'claude-haiku-5-5', effort: 'medium' }
} as const
