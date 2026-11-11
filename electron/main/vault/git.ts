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
  // One git process at a time: a timed flush and a Keep commit would otherwise race for index.lock.
  private chain: Promise<unknown> = Promise.resolve()
  /** Last commit failure, shown in the app until a commit succeeds. */
  lastError: string | null = null

  constructor(
    private vault: string,
    private enabled: () => boolean,
    private onError: () => void = () => {}
  ) {}

  get available() {
    return existsSync(join(this.vault, '.git'))
  }

  record(file: string, message: string) {
    if (!this.enabled() || !this.available) return
    const list = this.pending.get(file) ?? []
    list.push(message)
    this.pending.set(file, list)
    this.schedule(4000)
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), ms)
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn)
    this.chain = next.catch(() => {})
    return next
  }

  private async commit(files: string[], subject: string, body?: string) {
    await run('git', ['-C', this.vault, 'add', '--', ...files])
    const args = ['-C', this.vault, 'commit', '--quiet', '-m', subject]
    if (body) args.push('-m', body)
    await run('git', [...args, '--only', '--', ...files])
  }

  /** Commit specific files right away (regardless of the auto-commit setting). */
  async commitNow(files: string[], subject: string, body?: string) {
    if (!this.available || !files.length) return
    await this.serial(() => this.commit(files, subject, body))
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.pending.size) return
    const batch = new Map(this.pending)
    this.pending.clear()
    const files = [...batch.keys()]
    const messages = [...batch.values()].flat()
    const subject = messages.length === 1 ? `planner: ${messages[0]}` : `planner: ${messages.length} updates`
    const body = messages.length > 1 ? messages.map((m) => `- ${m}`).join('\n') : ''
    await this.serial(async () => {
      try {
        await this.commit(files, subject, body)
        if (this.lastError) {
          this.lastError = null
          this.onError()
        }
      } catch (err) {
        const msg = String((err as { stderr?: string }).stderr ?? err).trim()
        // Nothing to commit (e.g. an edit that was reverted) is fine.
        if (/nothing (added )?to commit|no changes added/i.test(msg)) return
        console.error('[git]', msg)
        // Keep the messages so the next attempt still describes these edits.
        for (const [f, m] of batch) this.pending.set(f, [...m, ...(this.pending.get(f) ?? [])])
        this.lastError = msg.split('\n')[0].slice(0, 200)
        this.onError()
        this.schedule(30_000)
      }
    })
  }
}
