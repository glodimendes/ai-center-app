import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentOrganization, FoundAgent } from '@shared/agents'
import { AgentError, ID_RE, parseAgent, readForeignAgent, serializeAgent, type AgentDef } from './definition'

export interface RegistryListing {
  agents: AgentDef[]
  /** Files that couldn't be read, so one bad file doesn't hide the rest. */
  errors: { id: string; message: string }[]
}

/** What the app keeps per agents folder: which files are agents, which are ignored, and how they're organized. */
interface OrgRecord extends AgentOrganization {
  /** Ids (file names without .md) created or accepted in the app. Only these are agents. */
  accepted: string[]
  /** File names the user chose to ignore. */
  ignored: string[]
}

/**
 * Agent definitions live as Markdown files in one folder, but only the ones created or accepted in the app are
 * agents: another tool writing a file there doesn't make it run, chat or receive handoffs. Its organization
 * (accepted, ignored, groups, pins) is kept in app data, keyed by folder, so the files stay plain definitions.
 * Without `orgFile` (tests, tools) every file counts, as before.
 */
export class AgentRegistry {
  constructor(
    private dir: () => string,
    private orgFile?: string
  ) {}

  private files(): string[] {
    const dir = this.dir()
    return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : []
  }

  private loadAll(): Record<string, OrgRecord> {
    try {
      return this.orgFile && existsSync(this.orgFile) ? JSON.parse(readFileSync(this.orgFile, 'utf8')) : {}
    } catch {
      return {}
    }
  }

  /** The record for this folder. The first time a folder is seen, every file already in it counts as accepted and pinned. */
  private org(): OrgRecord | null {
    if (!this.orgFile) return null
    const all = this.loadAll()
    const have: Partial<OrgRecord> | undefined = all[this.dir()]
    if (have) return { groups: have.groups ?? [], group: have.group ?? {}, pinned: have.pinned ?? [], accepted: have.accepted ?? [], ignored: have.ignored ?? [] }
    const ids = this.files().map((f) => f.slice(0, -3)).filter((id) => ID_RE.test(id))
    const rec: OrgRecord = { accepted: ids, ignored: [], groups: [], group: {}, pinned: ids }
    this.saveOrg(rec)
    return rec
  }

  private saveOrg(rec: OrgRecord) {
    if (!this.orgFile) return
    // Groups nobody uses any more disappear; the order of the rest is kept.
    const used = new Set(Object.values(rec.group))
    rec.groups = rec.groups.filter((g) => used.has(g))
    try {
      writeFileSync(this.orgFile, JSON.stringify({ ...this.loadAll(), [this.dir()]: rec }))
    } catch {
      /* best effort: the files themselves are unaffected */
    }
  }

  private update(fn: (rec: OrgRecord) => void) {
    const rec = this.org()
    if (!rec) return
    fn(rec)
    this.saveOrg(rec)
  }

  list(): RegistryListing {
    const dir = this.dir()
    const out: RegistryListing = { agents: [], errors: [] }
    const rec = this.org()
    const accepted = rec ? new Set(rec.accepted) : null
    for (const f of this.files()) {
      const id = f.slice(0, -3)
      if (accepted && !accepted.has(id)) continue
      try {
        out.agents.push(parseAgent(id, readFileSync(join(dir, f), 'utf8')))
      } catch (e) {
        out.errors.push({ id, message: e instanceof AgentError ? e.message : String(e) })
      }
    }
    return out
  }

  get(id: string): AgentDef | undefined {
    return this.list().agents.find((a) => a.id === id)
  }

  /** Files no one has accepted or ignored yet, with how each would be imported. */
  found(): FoundAgent[] {
    const rec = this.org()
    if (!rec) return []
    const known = new Set([...rec.accepted.map((id) => `${id}.md`), ...rec.ignored])
    return this.files()
      .filter((f) => !known.has(f))
      .map((file) => {
        try {
          const r = readForeignAgent(file, readFileSync(join(this.dir(), file), 'utf8'), (id) => this.taken(id))
          return { file, def: r.def, notes: r.notes }
        } catch (e) {
          return { file, notes: [], error: e instanceof AgentError ? e.message : String(e) }
        }
      })
  }

  /** An id an imported agent can't use: an existing file, or an agent the app already has. */
  private taken(id: string) {
    return existsSync(join(this.dir(), `${id}.md`)) || Boolean(this.org()?.accepted.includes(id))
  }

  /** Accepts a found file as an agent: as it is when it reads cleanly, otherwise saved under a new name (the original is then ignored). */
  importFile(file: string): AgentDef {
    if (!this.files().includes(file)) throw new AgentError(`${file} isn't in the agents folder.`)
    const r = readForeignAgent(file, readFileSync(join(this.dir(), file), 'utf8'), (id) => this.taken(id))
    if (r.inPlace) {
      this.update((rec) => {
        rec.accepted = [...new Set([...rec.accepted, r.def.id])]
        rec.pinned = [...new Set([...rec.pinned, r.def.id])]
      })
      return r.def
    }
    this.save(r.def)
    this.update((rec) => {
      rec.ignored = [...new Set([...rec.ignored, file])]
    })
    return r.def
  }

  ignoreFile(file: string, ignore = true) {
    this.update((rec) => {
      rec.ignored = ignore ? [...new Set([...rec.ignored, file])] : rec.ignored.filter((f) => f !== file)
    })
  }

  ignored(): string[] {
    const files = new Set(this.files())
    return (this.org()?.ignored ?? []).filter((f) => files.has(f))
  }

  organization(): AgentOrganization {
    const rec = this.org()
    return rec ? { groups: rec.groups, group: rec.group, pinned: rec.pinned } : { groups: [], group: {}, pinned: this.list().agents.map((a) => a.id) }
  }

  /** Puts an agent in a group (created when new, at the end); an empty name takes it out of any group. */
  setGroup(id: string, group: string) {
    const name = group.trim().slice(0, 40)
    this.update((rec) => {
      if (name) {
        rec.group[id] = name
        if (!rec.groups.includes(name)) rec.groups.push(name)
      } else delete rec.group[id]
    })
  }

  /** Moves a group one place up or down in the order. */
  moveGroup(group: string, dir: -1 | 1) {
    this.update((rec) => {
      const i = rec.groups.indexOf(group)
      const j = i + dir
      if (i < 0 || j < 0 || j >= rec.groups.length) return
      ;[rec.groups[i], rec.groups[j]] = [rec.groups[j], rec.groups[i]]
    })
  }

  setPinned(id: string, pinned: boolean) {
    this.update((rec) => {
      rec.pinned = pinned ? [...new Set([...rec.pinned, id])] : rec.pinned.filter((x) => x !== id)
    })
  }

  /** Writes a definition. An agent saved from the app (new, a sample, an import) is accepted, and pinned when it's new. */
  save(def: AgentDef) {
    if (!ID_RE.test(def.id)) throw new AgentError(`"${def.id}" isn't a valid agent id.`)
    const text = serializeAgent(def)
    parseAgent(def.id, text) // never write a file we couldn't read back
    mkdirSync(this.dir(), { recursive: true })
    const isNew = !this.org()?.accepted.includes(def.id)
    writeFileSync(join(this.dir(), `${def.id}.md`), text)
    if (isNew)
      this.update((rec) => {
        rec.accepted.push(def.id)
        rec.pinned = [...new Set([...rec.pinned, def.id])]
        rec.ignored = rec.ignored.filter((f) => f !== `${def.id}.md`)
      })
  }

  remove(id: string) {
    if (!ID_RE.test(id)) throw new AgentError(`"${id}" isn't a valid agent id.`)
    rmSync(join(this.dir(), `${id}.md`), { force: true })
    this.update((rec) => {
      rec.accepted = rec.accepted.filter((x) => x !== id)
      rec.pinned = rec.pinned.filter((x) => x !== id)
      delete rec.group[id]
    })
  }
}
