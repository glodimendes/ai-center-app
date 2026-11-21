import { app, safeStorage, shell } from 'electron'
import { createServer } from 'node:http'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { google } from 'googleapis'
import type { Auth } from 'googleapis'
import { GMAIL_SCOPES, realGmail, type GmailLike } from './agents/gmail'

const tokenFile = () => join(app.getPath('userData'), 'gmail-tokens.bin')

function save(tokens: Auth.Credentials) {
  const json = JSON.stringify(tokens)
  writeFileSync(tokenFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json))
}

function load(): Auth.Credentials | null {
  if (!existsSync(tokenFile())) return null
  try {
    const buf = readFileSync(tokenFile())
    return JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString())
  } catch {
    return null
  }
}

/**
 * Gmail sign-in with the same Google OAuth client the calendar uses (Settings), but its own scopes and token file:
 * read mail and create drafts, never send. The Gmail API must be enabled in that Google Cloud project.
 */
export class GmailAuth {
  constructor(private creds: () => { id?: string; secret?: string }) {}

  get configured() {
    const c = this.creds()
    return Boolean(c.id && c.secret)
  }

  get connected() {
    return this.configured && load() !== null
  }

  private client(redirect = 'http://127.0.0.1'): Auth.OAuth2Client {
    const c = this.creds()
    const client = new google.auth.OAuth2(c.id, c.secret, redirect)
    client.on('tokens', (t) => save({ ...client.credentials, ...t }))
    return client
  }

  async connect(): Promise<void> {
    if (!this.configured) throw new Error('Add your Google OAuth client ID and secret in Settings (Calendar) first.')
    const server = createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    const client = this.client(`http://127.0.0.1:${port}`)
    const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: GMAIL_SCOPES })
    const code = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Sign-in timed out.')), 5 * 60_000)
      server.on('request', (req, res) => {
        const u = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
        const code = u.searchParams.get('code')
        const error = u.searchParams.get('error')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<body style="font-family:system-ui;padding:40px">${code ? 'Gmail connected. You can close this tab and return to AI Center.' : `Sign-in failed: ${error ?? 'unknown error'}`}</body>`)
        clearTimeout(timeout)
        if (code) resolve(code)
        else reject(new Error(error ?? 'Sign-in failed.'))
      })
      void shell.openExternal(url)
    }).finally(() => server.close())
    const { tokens } = await client.getToken(code)
    save(tokens)
  }

  disconnect() {
    if (existsSync(tokenFile())) rmSync(tokenFile())
  }

  /** An authorised Gmail handle, or an error telling the user to connect. */
  async api(): Promise<GmailLike> {
    const tokens = this.configured ? load() : null
    if (!tokens) throw new Error('Gmail is not connected. Connect it in Settings → Data sources.')
    const client = this.client()
    client.setCredentials(tokens)
    return realGmail(client)
  }
}
