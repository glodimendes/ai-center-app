import type { ReactNode } from 'react'

/** `**bold**`, `*italic*`, `` `code` `` and [links](url) inside one line of text. */
function inline(text: string, key = ''): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    const k = `${key}${i++}`
    if (t.startsWith('**')) out.push(<strong key={k}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`')) out.push(<code key={k} className="px-1 py-0.5 rounded bg-sunken text-[0.9em] font-mono">{t.slice(1, -1)}</code>)
    else if (t.startsWith('[')) {
      const [, label, url] = t.match(/\[([^\]]+)\]\(([^)]+)\)/)!
      out.push(<a key={k} href={url} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">{label}</a>)
    } else out.push(<em key={k}>{t.slice(1, -1)}</em>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/**
 * A small Markdown subset for chat answers: paragraphs, headings, bullet and numbered lists, block quotes, code fences and
 * inline emphasis. Built as React nodes, never as HTML, so nothing an agent writes can inject markup.
 */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let n = 0
  while (i < lines.length) {
    const line = lines[i]
    const key = `b${n++}`
    if (!line.trim()) {
      i++
    } else if (line.startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++])
      i++
      blocks.push(<pre key={key} className="rounded-xl bg-sunken px-4 py-3 text-[13px] leading-relaxed font-mono overflow-x-auto whitespace-pre">{code.join('\n')}</pre>)
    } else if (/^#{1,4}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length
      blocks.push(<div key={key} className={level <= 2 ? 'text-[17px] font-semibold mt-2' : 'text-[15px] font-semibold mt-1'}>{inline(line.replace(/^#+\s/, ''), key)}</div>)
      i++
    } else if (line.startsWith('>')) {
      const quote: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''))
      blocks.push(
        <blockquote key={key} className="border-l-2 border-line pl-4 text-muted">
          {quote.map((q, j) => (
            <div key={j}>{inline(q, `${key}${j}`)}</div>
          ))}
        </blockquote>
      )
    } else if (/^\s*([-*•]|\d+[.)])\s/.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s/, ''))
      const L = ordered ? 'ol' : 'ul'
      blocks.push(
        <L key={key} className={ordered ? 'list-decimal pl-6 space-y-1' : 'list-disc pl-6 space-y-1'}>
          {items.map((t, j) => (
            <li key={j}>{inline(t, `${key}${j}`)}</li>
          ))}
        </L>
      )
    } else {
      const para: string[] = []
      while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|>|\s*([-*•]|\d+[.)])\s)/.test(lines[i])) para.push(lines[i++])
      blocks.push(
        <p key={key}>
          {para.map((t, j) => (
            <span key={j}>
              {j > 0 && <br />}
              {inline(t, `${key}${j}`)}
            </span>
          ))}
        </p>
      )
    }
  }
  return <div className="space-y-3">{blocks}</div>
}
