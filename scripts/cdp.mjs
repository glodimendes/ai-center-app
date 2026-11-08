// Inspect the running app over the DevTools protocol (start it with --remote-debugging-port=9333).
// Usage: node scripts/cdp.mjs <out.png> [js-to-eval-in-renderer] [waitMs]
const [, , out, js, wait = '800'] = process.argv
const targets = await (await fetch('http://127.0.0.1:9333/json')).json()
const page = targets.find((t) => t.type === 'page' && !t.url.includes('#capture'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
await new Promise((r) => (ws.onopen = r))
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Runtime.enable')
await send('Log.enable')
if (js) {
  const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true })
  console.log('eval:', JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r.result).slice(0, 2000))
}
await new Promise((r) => setTimeout(r, Number(wait)))
const shot = await send('Page.captureScreenshot', { format: 'png' })
const { writeFileSync } = await import('node:fs')
writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
ws.close()
