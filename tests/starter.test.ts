import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStarterVault } from '../electron/main/vault/starter'
import { parseTasks } from '../electron/main/vault/parser'
import { DEFAULT_PREFERENCES } from '../electron/main/vault/preferences'
import { initRepo } from '../electron/main/vault/git'
import { ABOUT_ME_FILE, CLAUDE_FILE, MAINTENANCE_FILE, PRIORITIES_FILE, RULES_FILE, TODOS_FILE } from '../shared/paths'

describe('starter vault', () => {
  it('creates example files the planner parses, and never overwrites what exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'starter-'))
    createStarterVault(root)
    const todos = readFileSync(join(root, TODOS_FILE), 'utf8')
    const { tasks } = parseTasks(todos, TODOS_FILE, DEFAULT_PREFERENCES.categories, new Date(2026, 10, 21))
    expect(tasks.length).toBeGreaterThanOrEqual(3)
    // the shipped defaults know the starter headings and nothing personal
    expect(tasks.map((t) => t.category).sort()).toEqual(['personal', 'work', 'work'])
    expect(JSON.stringify(DEFAULT_PREFERENCES)).not.toMatch(/Study Schedule|Thesis|Courses|Outside work/)
    expect(tasks.find((t) => t.estimateMin === 120)).toBeTruthy()
    expect(tasks.find((t) => t.due === '2026-12-31')).toBeTruthy()
    // the files the prompts and Review expect are there
    for (const f of [RULES_FILE, MAINTENANCE_FILE, ABOUT_ME_FILE]) expect(existsSync(join(root, f))).toBe(true)
    expect(readFileSync(join(root, CLAUDE_FILE), 'utf8')).toMatch(/^@AGENTS\.md\n/)
    expect(readFileSync(join(root, PRIORITIES_FILE), 'utf8')).toMatch(/^## Active Priority Areas\n\n1\. /m)
    writeFileSync(join(root, TODOS_FILE), '# mine\n')
    createStarterVault(root)
    expect(readFileSync(join(root, TODOS_FILE), 'utf8')).toBe('# mine\n')
    rmSync(root, { recursive: true })
  })

  it('gets its own git history so app changes can be undone', () => {
    const root = mkdtempSync(join(tmpdir(), 'starter-git-'))
    createStarterVault(root)
    expect(initRepo(root, 'starter')).toBe(true)
    expect(existsSync(join(root, '.git'))).toBe(true)
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.DS_Store')
    rmSync(root, { recursive: true })
  })
})
