import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentError, parseAgent, serializeAgent } from '../electron/main/agents/definition'
import { attachDirs, attachmentBlock } from '../electron/main/agents/attachments'
import { listFiles, rankFiles } from '../electron/main/agents/files'
import { resolveDirs } from '../electron/main/agents/runner'
import { codexCli } from '../electron/main/agents/engines/codex-cli'
import { findProfile } from '../electron/main/agents/profiles'

const tmp = () => mkdtempSync(join(tmpdir(), 'chat-files-'))

describe('agent folders', () => {
  const base = '---\nname: A\nfolders:\n  - projects/x\n  - /abs/y\n---\n\nDo it.\n'
  it('are parsed, serialized and refuse ..', () => {
    const d = parseAgent('a', base)
    expect(d.folders).toEqual(['projects/x', '/abs/y'])
    expect(parseAgent('a', serializeAgent(d)).folders).toEqual(d.folders)
    expect(() => parseAgent('a', base.replace('projects/x', '../x'))).toThrow(AgentError)
  })
  it('resolveDirs adds the extra folders and the vault, dropping ones already inside the main folder', () => {
    const o = { vaultRoot: '/v', workspaces: '/w' }
    expect(resolveDirs({ id: 'a', folders: ['/data', 'projects'] }, o)).toEqual({ cwd: '/w/a', extra: ['/data', '/v'] })
    expect(resolveDirs({ id: 'a', workdir: '/v/projects/p', folders: ['/data'] }, o).extra).toEqual(['/data', '/v'])
    expect(resolveDirs({ id: 'a', workdir: '/v' }, o).extra).toEqual([])
  })
})

describe('attachments', () => {
  it('file-capable engines get paths, others get the text inline', () => {
    const dir = tmp()
    const f = join(dir, 'a.md')
    writeFileSync(f, 'hello')
    expect(attachmentBlock([f], true)).toContain(`- ${f}`)
    const inline = attachmentBlock([f, join(dir, 'b.pdf')], false)
    expect(inline).toContain('hello')
    expect(inline).toContain('b.pdf: not readable by this engine')
    expect(attachmentBlock([], true)).toBe('')
  })
  it('attachDirs only adds folders no known folder covers', () => {
    expect(attachDirs(['/v/a.md', '/x/y/b.md', '/x/y/c.md'], ['/v'])).toEqual(['/x/y'])
  })
})

describe('file references', () => {
  it('lists files without dot folders or node_modules and ranks name matches first', () => {
    const root = tmp()
    mkdirSync(join(root, 'notes'))
    mkdirSync(join(root, 'node_modules'))
    mkdirSync(join(root, '.git'))
    for (const f of ['notes/plan.md', 'notes/budget-plan.md', 'node_modules/plan.js', '.git/plan', 'readme.md']) writeFileSync(join(root, f), '')
    const all = listFiles(root)
    expect(all.map((e) => e.rel).sort()).toEqual(['notes/budget-plan.md', 'notes/plan.md', 'readme.md'])
    expect(rankFiles(all, 'plan').map((h) => h.rel)).toEqual(['notes/plan.md', 'notes/budget-plan.md'])
    expect(rankFiles(all, 'rdm').map((h) => h.rel)).toEqual(['readme.md'])
  })
})

describe('codex resume keeps extra folders writable', () => {
  it('passes writable_roots as config in edit mode', () => {
    const p = codexCli.prepare({ profile: findProfile('codex'), mode: 'edit', prompt: 'P', cwd: '/w', addDirs: ['/v', '/d'], timeoutMs: 1, session: { id: 's', resume: true } })
    expect(p.args).toContain('sandbox_workspace_write.writable_roots=["/v","/d"]')
  })
})
