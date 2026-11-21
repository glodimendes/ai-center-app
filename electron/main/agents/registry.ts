import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AgentError, ID_RE, parseAgent, serializeAgent, type AgentDef } from './definition'

export interface RegistryListing {
  agents: AgentDef[]
  /** Files that couldn't be read, so one bad file doesn't hide the rest. */
  errors: { id: string; message: string }[]
}

/** Agent definitions live as Markdown files in one folder; read on demand, written only through save(). */
export class AgentRegistry {
  constructor(private dir: () => string) {}

  list(): RegistryListing {
    const dir = this.dir()
    const out: RegistryListing = { agents: [], errors: [] }
    if (!existsSync(dir)) return out
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.md')) continue
      const id = f.slice(0, -3)
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

  save(def: AgentDef) {
    if (!ID_RE.test(def.id)) throw new AgentError(`"${def.id}" isn't a valid agent id.`)
    const text = serializeAgent(def)
    parseAgent(def.id, text) // never write a file we couldn't read back
    mkdirSync(this.dir(), { recursive: true })
    writeFileSync(join(this.dir(), `${def.id}.md`), text)
  }

  remove(id: string) {
    if (!ID_RE.test(id)) throw new AgentError(`"${id}" isn't a valid agent id.`)
    rmSync(join(this.dir(), `${id}.md`), { force: true })
  }
}
