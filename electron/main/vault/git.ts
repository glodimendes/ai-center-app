import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Batches app saves into small commits authored by the user's own git identity.
 * Only the files the app touched are committed; anything else staged or dirty is left alone.
 */
export class VaultGit {
  private pending = new Map<string, string[]>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    private vault: string,
    private enabled: () => boolean
  ) {}

  get available() {
    return existsSync(join(this.vault, '.git'))
  }

  record(file: string, message: string) {
    if (!this.enabled() || !this.available) return
    const list = this.pending.get(file) ?? []
    list.push(message)
    this.pending.set(file, list)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), 4000)
  }

  /** Commit specific files right away (regardless of the auto-commit setting). */
  async commitNow(files: string[], subject: string, body?: string) {
    if (!this.available || !files.length) return
    await run('git', ['-C', this.vault, 'add', '--', ...files])
    const args = ['-C', this.vault, 'commit', '--quiet', '-m', subject]
    if (body) args.push('-m', body)
    await run('git', [...args, '--only', '--', ...files])
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.pending.size) return
    const files = [...this.pending.keys()]
    const messages = [...this.pending.values()].flat()
    this.pending.clear()
    const subject = messages.length === 1 ? `planner: ${messages[0]}` : `planner: ${messages.length} updates`
    const body = messages.length > 1 ? messages.map((m) => `- ${m}`).join('\n') : ''
    try {
      await run('git', ['-C', this.vault, 'add', '--', ...files])
      const args = ['-C', this.vault, 'commit', '--quiet', '-m', subject]
      if (body) args.push('-m', body)
      await run('git', [...args, '--only', '--', ...files])
    } catch (err) {
      // Nothing to commit (e.g. edit reverted) is fine; anything else is logged.
      const msg = String((err as { stderr?: string }).stderr ?? err)
      if (!/nothing (added )?to commit|no changes added/i.test(msg)) console.error('[git]', msg)
    }
  }
}
