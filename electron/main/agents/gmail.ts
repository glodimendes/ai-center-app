import { google, type Auth } from 'googleapis'

/** Everything the agents may do with Gmail: read messages and create drafts. There is deliberately no send. */
export interface GmailMessage {
  from: string
  to: string
  subject: string
  date: string
  snippet: string
  body: string
}

export interface GmailLike {
  listIds(query: string, max: number): Promise<string[]>
  getMessage(id: string): Promise<GmailMessage>
  createDraft(raw: string): Promise<void>
}

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose']

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const fromB64url = (s: string) => Buffer.from(s, 'base64url').toString('utf8')

/** RFC 2047 for non-ASCII subjects. */
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`)

/** A plain-text draft as the base64url "raw" message Gmail's drafts.create expects. Header values can't carry line breaks. */
export function buildRawDraft(d: { to: string; subject: string; body: string }): string {
  const one = (s: string) => s.replace(/[\r\n]+/g, ' ').trim()
  const mime = [`To: ${one(d.to)}`, `Subject: ${encodeHeader(one(d.subject))}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(d.body, 'utf8').toString('base64')].join('\r\n')
  return b64url(mime)
}

/** The text of a message payload: its text/plain part, else its HTML with tags removed. */
export function payloadText(payload: any): string {
  const parts: any[] = []
  const walk = (p: any) => {
    if (!p) return
    parts.push(p)
    for (const c of p.parts ?? []) walk(c)
  }
  walk(payload)
  const find = (mime: string) => parts.find((p) => p.mimeType === mime && p.body?.data)
  const plain = find('text/plain')
  if (plain) return fromB64url(plain.body.data)
  const html = find('text/html')
  return html ? fromB64url(html.body.data).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''
}

/** Adapter over the real Gmail API with an authorised client. */
export function realGmail(auth: Auth.OAuth2Client): GmailLike {
  const gmail = google.gmail({ version: 'v1', auth })
  return {
    async listIds(query, max) {
      const res = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: max })
      return (res.data.messages ?? []).map((m) => m.id!).filter(Boolean)
    },
    async getMessage(id) {
      const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' })
      const h = (name: string) => res.data.payload?.headers?.find((x) => x.name?.toLowerCase() === name)?.value ?? ''
      return { from: h('from'), to: h('to'), subject: h('subject'), date: h('date'), snippet: res.data.snippet ?? '', body: payloadText(res.data.payload) }
    },
    async createDraft(raw) {
      await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } })
    }
  }
}

/** Recent mail as text for an agent's prompt: sender, subject, date and the start of each body. */
export async function fetchGmail(gmail: GmailLike, query: string, max: number): Promise<string> {
  const ids = await gmail.listIds(query || 'newer_than:3d', Math.min(Math.max(max, 1), 50))
  if (!ids.length) return '(no messages match)'
  const out: string[] = []
  for (const id of ids) {
    try {
      const m = await gmail.getMessage(id)
      out.push(`### ${m.subject || '(no subject)'}\nFrom: ${m.from}\nTo: ${m.to}\nDate: ${m.date}\n\n${(m.body || m.snippet).slice(0, 2500)}`)
    } catch {
      /* a message that can't be read is skipped */
    }
  }
  return out.join('\n\n')
}
