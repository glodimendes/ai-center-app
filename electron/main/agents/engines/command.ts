import type { Engine } from './types'

/**
 * A user-defined program: text in (as an argument), text out. It is the generic way to plug in any other CLI.
 * We can't restrict what it does, so it only takes `ask` and `read` runs that carry the prompt and sources as text.
 */
export const commandEngine: Engine = {
  id: 'command',
  chat: false,
  prepare(spec) {
    if (spec.mode === 'edit' || spec.mode === 'tools') throw new Error('A custom command can\'t be limited to a set of tools or to edits, so agents with propose/act permission need another engine.')
    const cmd = spec.profile.command
    if (!cmd?.length || !cmd[0].trim()) throw new Error('Set the command for this profile in Settings → Engines & accounts.')
    const [binary, ...rest] = cmd
    const args = rest.some((a) => a.includes('{prompt}')) ? rest.map((a) => a.replaceAll('{prompt}', spec.prompt)) : [...rest, spec.prompt]
    return { binary, args, cwd: spec.cwd, output: 'text' }
  },
  parse: () => []
}
