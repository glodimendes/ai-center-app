import { useState, type ReactNode } from 'react'
import { parseSegments, type Block, type Item } from './mdparse'

export interface MdOptions {
  /** Opens a vault file: `[[note]]` and relative `*.md` links become buttons that call this. */
  onOpenDoc?: (path: string) => void
}

/** `**bold**`, `*italic*`, `` `code` ``, [links](url) and `[[vault notes]]` inside one line of text. */
export function inline(text: string, key = '', opts: MdOptions = {}): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\]|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  const doc = (label: string, path: string, k: string) =>
    opts.onOpenDoc ? (
      <button key={k} onClick={() => opts.onOpenDoc!(path)} className="text-accent underline underline-offset-2 decoration-dotted hover:decoration-solid">
        {label}
      </button>
    ) : (
      <span key={k} className="text-accent">{label}</span>
    )
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    const k = `${key}${i++}`
    if (t.startsWith('**')) out.push(<strong key={k}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`')) out.push(<code key={k} className="px-1 py-0.5 rounded bg-sunken text-[0.9em] font-mono">{t.slice(1, -1)}</code>)
    else if (t.startsWith('[[')) {
      const name = t.slice(2, -2).split('|')[0].trim()
      out.push(doc(t.slice(2, -2).split('|').pop()!.trim(), /\.\w+$/.test(name) ? name : `${name}.md`, k))
    } else if (t.startsWith('[')) {
      const [, label, url] = t.match(/\[([^\]]+)\]\(([^)]+)\)/)!
      if (/^https?:\/\//.test(url)) out.push(<a key={k} href={url} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">{label}</a>)
      else if (/\.md$/i.test(url) && !url.includes(':')) out.push(doc(label, url.replace(/^\.?\//, ''), k))
      else out.push(label)
    } else out.push(<em key={k}>{t.slice(1, -1)}</em>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function CodeBlock({ code }: { code: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="relative group/code">
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(code)
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        }}
        className="absolute top-2 right-2 text-[11px] px-2 py-0.5 rounded-md bg-panel border border-line text-muted opacity-0 group-hover/code:opacity-100"
      >
        {done ? 'Copied' : 'Copy'}
      </button>
      <pre className="rounded-xl bg-sunken px-4 py-3 text-[13px] leading-relaxed font-mono overflow-x-auto whitespace-pre">{code}</pre>
    </div>
  )
}

function Items({ items, ordered, k, opts }: { items: Item[]; ordered: boolean; k: string; opts: MdOptions }) {
  const L = ordered ? 'ol' : 'ul'
  return (
    <L {...(ordered ? { start: items[0].num ?? 1 } : {})} className={ordered ? 'list-decimal pl-6 space-y-1' : 'pl-1 space-y-1'}>
      {items.map((it, j) => (
        <li key={j} className={it.check !== undefined || !ordered ? 'flex gap-2.5 list-none' : undefined}>
          {it.check !== undefined && <span className={`shrink-0 mt-[5px] w-4 h-4 rounded border grid place-items-center text-[10px] ${it.check ? 'bg-accent border-accent text-white' : 'border-faint'}`}>{it.check ? '✓' : ''}</span>}
          {it.check === undefined && !ordered && <span className="shrink-0 mt-[11px] w-1 h-1 rounded-full bg-faint" />}
          <div className="min-w-0 flex-1">
            <span className={it.check ? 'text-muted line-through' : undefined}>{inline(it.text, `${k}${j}`, opts)}</span>
            {it.children.length > 0 && (
              <div className="mt-1">
                <Items items={it.children} ordered={it.children[0].ordered} k={`${k}${j}`} opts={opts} />
              </div>
            )}
          </div>
        </li>
      ))}
    </L>
  )
}

function BlockView({ block, k, opts }: { block: Block; k: string; opts: MdOptions }) {
  switch (block.kind) {
    case 'code':
      return <CodeBlock code={block.code} />
    case 'heading':
      return <div className={block.level <= 2 ? 'text-[17px] font-semibold mt-1' : block.level === 3 ? 'text-[15.5px] font-semibold' : 'text-[14px] font-semibold text-muted'}>{inline(block.text, k, opts)}</div>
    case 'quote':
      return (
        <blockquote className="border-l-2 border-line pl-4 text-muted">
          {block.lines.map((q, j) => (
            <div key={j}>{inline(q, `${k}${j}`, opts)}</div>
          ))}
        </blockquote>
      )
    case 'table':
      return (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-[13.5px] border-collapse">
            <thead className="bg-sunken text-left">
              <tr>
                {block.head.map((h, j) => (
                  <th key={j} className="px-3 py-2 font-semibold whitespace-nowrap">{inline(h, `${k}h${j}`, opts)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r, ri) => (
                <tr key={ri} className="border-t border-line/70">
                  {r.map((c, ci) => (
                    <td key={ci} className="px-3 py-2 align-top">{inline(c, `${k}${ri}${ci}`, opts)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'item':
      return <Items items={[block.item]} ordered={block.item.ordered} k={k} opts={opts} />
    case 'para':
      return (
        <p>
          {block.lines.map((t, j) => (
            <span key={j}>
              {j > 0 && <br />}
              {inline(t, `${k}${j}`, opts)}
            </span>
          ))}
        </p>
      )
  }
}

/**
 * A Markdown subset for chat answers: paragraphs, headings, nested bullet / numbered / checkbox lists, tables, block quotes,
 * code fences with a copy button, inline emphasis and vault links. Built as React nodes, never as HTML, so nothing an agent
 * writes can inject markup. `segmentActions` adds a control to each section or top-level item (to hand just that part on).
 */
export function Markdown({ text, onOpenDoc, segmentActions }: { text: string; segmentActions?: (source: string) => ReactNode } & MdOptions) {
  const opts: MdOptions = { onOpenDoc }
  const segments = parseSegments(text)
  return (
    <div className="space-y-3">
      {segments.map((seg, si) => (
        <div key={si} className="group/seg relative">
          <div className="space-y-3">
            {seg.blocks.map((b, bi) => (
              <BlockView key={bi} block={b} k={`s${si}b${bi}`} opts={opts} />
            ))}
          </div>
          {segmentActions && <div className="absolute -right-9 top-0 opacity-0 group-hover/seg:opacity-100 focus-within:opacity-100">{segmentActions(seg.source)}</div>}
        </div>
      ))}
    </div>
  )
}
