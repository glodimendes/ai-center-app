import { agyCli } from './agy-cli'
import { claudeCli } from './claude-cli'
import { commandEngine } from './command'
import { ollamaEngine } from './ollama'
import { codexCli } from './codex-cli'
import type { Engine, EngineId } from './types'

export const ENGINES: Record<EngineId, Engine> = { claude: claudeCli, codex: codexCli, agy: agyCli, ollama: ollamaEngine, command: commandEngine }
export * from './types'
export { ollamaModels } from './ollama'
export { CONTEXT_MODELS } from './models'
export { EngineTimeout, keepTail, profileEnv, resolveBinary, runEngine, stop } from './process'
