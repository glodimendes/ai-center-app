import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentRegistry } from '../electron/main/agents/registry'
import { readForeignAgent } from '../electron/main/agents/definition'

const roots: string[] = []
function setup(files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agent-org-'))
  roots.push(root)
  const dir = join(root, 'agents')
  mkdirSync(dir)
  for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t)
  const reg = new AgentRegistry(() => dir, join(root, 'org.json'))
  reg.list() // the app reads the folder at start, before another tool adds anything
  return { dir, reg, put: (f: string, t: string) => writeFileSync(join(dir, f), t) }
}
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })))

const own = (name: string) => `---\nname: ${name}\nprofile: claude\npermission: read\noutput: reply\n---\n\nDo the ${name} job.\n`
const claudeSubagent = `---\nname: code-reviewer\ndescription: Reviews code for quality\ntools: Read, Grep, Bash\nmodel: inherit\n---\n\nYou review code. Be specific.\n`
const codexPrompt = `---\ndescription: Summarise a pull request\nargument-hint: [pr-number]\n---\n\nSummarise pull request $ARGUMENTS in five bullets.\n`

describe('agent organization', () => {
  it('accepts and pins the files already there the first time; a file added later waits to be imported', () => {
    const { reg, put } = setup({ 'thesis.md': own('Thesis'), 'coach.md': own('Coach') })
    expect(reg.list().agents.map((a) => a.id)).toEqual(['coach', 'thesis'])
    expect(reg.organization().pinned.sort()).toEqual(['coach', 'thesis'])
    put('code-reviewer.md', claudeSubagent)
    expect(reg.list().agents.map((a) => a.id)).not.toContain('code-reviewer')
    expect(reg.get('code-reviewer')).toBeUndefined() // can't chat, run or receive a handoff
    expect(reg.found().map((f) => f.file)).toEqual(['code-reviewer.md'])
  })

  it('imports a Claude Code subagent as it is: tool list ignored, permission from the app, `inherit` = default model', () => {
    const { reg, put, dir } = setup()
    put('code-reviewer.md', claudeSubagent)
    const [f] = reg.found()
    expect(f.def).toMatchObject({ id: 'code-reviewer', permission: 'read', model: undefined, description: 'Reviews code for quality' })
    expect(f.notes.join(' ')).toMatch(/Ignored: tool list/)
    reg.importFile('code-reviewer.md')
    expect(reg.get('code-reviewer')?.instructions).toContain('You review code')
    expect(readFileSync(join(dir, 'code-reviewer.md'), 'utf8')).toBe(claudeSubagent) // the other tool's file is untouched
    expect(reg.found()).toEqual([])
    expect(reg.organization().pinned).toContain('code-reviewer')
  })

  it('imports a Codex prompt with an unusable file name into a new file and hides the original', () => {
    const { reg, put, dir } = setup()
    put('Review PR.md', codexPrompt)
    const [f] = reg.found()
    expect(f.def?.id).toBe('review-pr')
    expect(f.notes.join(' ')).toMatch(/argument hint/)
    expect(f.notes.join(' ')).toMatch(/\$ARGUMENTS/)
    reg.importFile('Review PR.md')
    expect(reg.get('review-pr')?.description).toBe('Summarise a pull request')
    expect(existsSync(join(dir, 'Review PR.md'))).toBe(true)
    expect(reg.ignored()).toEqual(['Review PR.md'])
    expect(reg.found()).toEqual([])
  })

  it('reads a file without frontmatter, and never overwrites the original when it saves a copy', () => {
    const { reg, put, dir } = setup()
    const plain = '# Weekly summary\n\nSummarise my week from the weekly logs.\n'
    put('weekly.md', plain)
    const [f] = reg.found()
    expect(f.def).toMatchObject({ name: 'Weekly summary', permission: 'read' })
    expect(f.def?.id).not.toBe('weekly')
    reg.importFile('weekly.md')
    expect(readFileSync(join(dir, 'weekly.md'), 'utf8')).toBe(plain)
    expect(reg.list().agents).toHaveLength(1)
  })

  it('ignores and shows again; groups keep their order and vanish when empty; pins toggle; delete forgets the agent', () => {
    const { reg, put } = setup({ 'a.md': own('A'), 'b.md': own('B') })
    reg.list()
    put('x.md', 'no frontmatter, just text\n')
    reg.ignoreFile('x.md')
    expect(reg.found()).toEqual([])
    reg.ignoreFile('x.md', false)
    expect(reg.found().map((f) => f.file)).toEqual(['x.md'])
    reg.setGroup('a', 'Study')
    reg.setGroup('b', 'Work')
    reg.moveGroup('Work', -1)
    expect(reg.organization().groups).toEqual(['Work', 'Study'])
    reg.setGroup('b', '')
    expect(reg.organization().groups).toEqual(['Study'])
    reg.setPinned('a', false)
    expect(reg.organization().pinned).toEqual(['b'])
    reg.remove('a')
    expect(reg.organization().group).toEqual({})
    expect(reg.list().agents.map((g) => g.id)).toEqual(['b'])
  })

  it('an agent saved in the app is accepted and pinned', () => {
    const { reg } = setup()
    reg.save({ id: 'new-one', name: 'New', profile: 'claude', permission: 'read', sources: [], triggers: ['manual'], output: 'reply', instructions: 'Hi' })
    expect(reg.list().agents.map((a) => a.id)).toEqual(['new-one'])
    expect(reg.organization().pinned).toEqual(['new-one'])
  })

  it('reports why a file cannot be imported', () => {
    expect(() => readForeignAgent('empty.md', '---\nname: x\n---\n', () => false)).toThrow(/no instructions/)
    const { reg, put } = setup()
    put('bad.md', '---\nname: x\n  bad: indent: here\n---\nText\n')
    expect(reg.found()[0].error).toMatch(/YAML/)
  })
})

describe('frontmatter written by hand or by AI tools', () => {
  it('reads a description with an unquoted ": " instead of failing', async () => {
    const { parseAgent } = await import('../electron/main/agents/definition')
    const text = '---\nname: Course tutor\nprofile: claude\npermission: read\noutput: reply\ntriggers: [manual]\nsources: [a, b]\ndescription: Tutor for my courses (A, B): diagnostic questions, hints first.\n---\n\nTeach me.\n'
    const def = parseAgent('course-tutor', text)
    expect(def.description).toBe('Tutor for my courses (A, B): diagnostic questions, hints first.')
    expect(def.triggers).toEqual(['manual'])
    expect(def.sources).toEqual(['a', 'b'])
    // nested YAML that is really broken still reports the error
    expect(() => parseAgent('x', '---\nname: x\n  bad: indent: here\n---\nHi\n')).toThrow(/YAML/)
  })
})
