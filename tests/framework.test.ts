import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TEMPLATES, checkFramework, missingFiles } from '../electron/main/vault/framework'
import { createStarterVault } from '../electron/main/vault/starter'
import { ABOUT_ME_FILE, CLAUDE_FILE, RULES_FILE, START_FILE, TODOS_FILE } from '../shared/paths'

const roots: string[] = []
const tmp = () => {
  const r = mkdtempSync(join(tmpdir(), 'framework-'))
  roots.push(r)
  return r
}
const put = (root: string, rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })))

describe('vault framework', () => {
  it("a chosen folder gets only what it lacks; the user's files are kept as they are", () => {
    const root = tmp()
    put(root, TODOS_FILE, '# My tasks\n- [ ] mine\n')
    put(root, START_FILE, '# my own entry point\n')
    const { missing } = checkFramework(root)
    expect(missing).not.toContain(TODOS_FILE)
    expect(missing).not.toContain(START_FILE)
    expect(missing).toEqual(expect.arrayContaining([CLAUDE_FILE, RULES_FILE, ABOUT_ME_FILE]))
    const files = missingFiles(root)
    expect(files.map((f) => f.path).sort()).toEqual([...missing].sort())
    expect(files.every((f) => f.text === TEMPLATES[f.path])).toBe(true)
  })

  it('adds nothing to a vault in another (numbered) layout', () => {
    const root = tmp()
    mkdirSync(join(root, '05_Tasks'))
    expect(checkFramework(root)).toEqual({ missing: [], otherLayout: true })
    expect(missingFiles(root)).toEqual([])
  })

  it('a starter vault is complete and keeps its example tasks', () => {
    const root = tmp()
    createStarterVault(root)
    expect(checkFramework(root)).toEqual({ missing: [], otherLayout: false })
    expect(readFileSync(join(root, TODOS_FILE), 'utf8')).toContain('~2h')
  })
})
