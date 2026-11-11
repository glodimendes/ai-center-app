import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ContextChange, ContextEngine, ContextResult } from '@shared/types'
import type { VaultService } from '../vault/service'
import { runContextAgent, snapshotVault, type AgentRun } from './agent'
import { revertEdits } from './revert'

/**
 * One Update context run at a time: snapshot the vault's text files, run the agent, diff, and hold
 * the result until the user keeps or undoes it. Nothing the agent wrote is kept without Keep.
 */
export class ContextSession {
  private agent: AgentRun | null = null
  private pending: ContextResult | null = null
  /** Set for the whole run, so the app's own vault writes can wait instead of mixing into its diff. */
  running: Promise<void> | null = null

  constructor(
    private vault: () => VaultService,
    private engine: () => ContextEngine,
    private onProgress: (line: string) => void
  ) {}

  async update(instruction: string): Promise<ContextResult> {
    if (this.running) throw new Error('A context update is already running.')
    if (this.pending) throw new Error('Keep or undo the previous context update first.')
    const vault = this.vault()
    let finished!: () => void
    this.running = new Promise<void>((r) => (finished = r))
    try {
      await vault.git.flush()
      const before = snapshotVault(vault.root)
      try {
        this.agent = await runContextAgent(this.engine(), vault.root, instruction, this.onProgress)
        const summary = await this.agent.done
        const after = snapshotVault(vault.root)
        const changes: ContextChange[] = []
        for (const [path, text] of after) {
          const prev = before.get(path) ?? null
          if (prev !== text) changes.push({ path, before: prev, after: text })
        }
        changes.sort((a, b) => a.path.localeCompare(b.path))
        this.pending = changes.length ? { instruction, summary, changes } : null
        return { instruction, summary, changes }
      } catch (err) {
        // A cancelled or failed run must not leave half-made edits behind.
        const after = snapshotVault(vault.root)
        const paths = new Set([...before.keys(), ...after.keys()])
        this.revert([...paths].map((path) => ({ path, before: before.get(path) ?? null, after: after.get(path) ?? null })).filter((c) => c.before !== c.after))
        throw err
      }
    } finally {
      this.agent = null
      this.running = null
      finished()
    }
  }

  cancel() {
    this.agent?.cancel()
  }

  async keep() {
    const p = this.pending
    if (!p) return
    this.pending = null
    const short = p.instruction.replace(/\s+/g, ' ').slice(0, 60)
    await this.vault().git.commitNow(
      p.changes.map((c) => c.path),
      `planner: update context: ${short}${p.instruction.length > 60 ? '…' : ''}`,
      `Instruction: ${p.instruction}`
    )
  }

  /** Returns the files left as they are because they changed since in a way that can't be separated. */
  undo(): string[] {
    const p = this.pending
    if (!p) return []
    this.pending = null
    return this.revert(p.changes)
  }

  /**
   * Puts the agent's edits back, file by file, without losing anything written since (in Obsidian,
   * by the app, by an automation): only the agent's own lines are reverted.
   */
  private revert(changes: { path: string; before: string | null; after: string | null }[]): string[] {
    const root = this.vault().root
    const skipped: string[] = []
    for (const c of changes) {
      const abs = join(root, c.path)
      const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null
      if (current === c.before) continue
      if (current === c.after) {
        if (c.before === null) rmSync(abs, { force: true })
        else writeFileSync(abs, c.before)
        continue
      }
      const merged = c.before !== null && c.after !== null && current !== null ? revertEdits(c.before, c.after, current) : null
      if (merged === null) skipped.push(c.path)
      else writeFileSync(abs, merged)
    }
    return skipped
  }
}
