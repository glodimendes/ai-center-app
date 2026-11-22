import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStarterVault } from '../electron/main/vault/starter'
import { parseTasks } from '../electron/main/vault/parser'
import { DEFAULT_PREFERENCES } from '../electron/main/vault/preferences'

describe('starter vault', () => {
  it('creates example files the planner parses, and never overwrites what exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'starter-'))
    createStarterVault(root)
    const todos = readFileSync(join(root, '05_Tasks/daily-todos.md'), 'utf8')
    const { tasks } = parseTasks(todos, '05_Tasks/daily-todos.md', DEFAULT_PREFERENCES.categories, new Date(2026, 10, 21))
    expect(tasks.length).toBeGreaterThanOrEqual(3)
    // the shipped defaults know the starter headings and nothing personal
    expect(tasks.map((t) => t.category).sort()).toEqual(['personal', 'work', 'work'])
    expect(JSON.stringify(DEFAULT_PREFERENCES)).not.toMatch(/ETH|Study Schedule|BRASA|Switzerland/)
    expect(tasks.find((t) => t.estimateMin === 120)).toBeTruthy()
    expect(tasks.find((t) => t.due === '2026-12-31')).toBeTruthy()
    writeFileSync(join(root, '05_Tasks/daily-todos.md'), '# mine\n')
    createStarterVault(root)
    expect(readFileSync(join(root, '05_Tasks/daily-todos.md'), 'utf8')).toBe('# mine\n')
    rmSync(root, { recursive: true })
  })
})
