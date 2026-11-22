// Pure Markdown parsing for chat answers (rendering is in markdown.tsx).
const LIST_RE = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

export interface Item {
  indent: number
  ordered: boolean
  /** The written number of a numbered item, so a list split into segments keeps counting. */
  num?: number
  check?: boolean
  text: string
  children: Item[]
}
export type Block =
  | { kind: 'code'; code: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'list'; items: Item[] }
  | { kind: 'para'; lines: string[] }
  | { kind: 'item'; item: Item }

/** A piece of an answer that can be handed on by itself: a section (heading and what follows it) or one top-level block or list item. */
export interface Segment {
  /** The segment's own Markdown, for sending or adding as a task. */
  source: string
  blocks: Block[]
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())

function itemSource(it: Item): string {
  const self = `${'  '.repeat(Math.max(0, it.indent))}${it.ordered ? `${it.num ?? 1}.` : '-'} ${it.check === undefined ? '' : it.check ? '[x] ' : '[ ] '}${it.text}`
  return [self, ...it.children.map(itemSource)].join('\n')
}

/** Parses Markdown into top-level segments (see Segment). Exported for tests. */
export function parseSegments(text: string): Segment[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const flat: { block: Block; source: string }[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const start = i
    if (!line.trim()) {
      i++
    } else if (line.startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++])
      i++
      flat.push({ block: { kind: 'code', code: code.join('\n') }, source: lines.slice(start, i).join('\n') })
    } else if (/^#{1,6}\s/.test(line)) {
      flat.push({ block: { kind: 'heading', level: line.match(/^#+/)![0].length, text: line.replace(/^#+\s+/, '') }, source: line })
      i++
    } else if (line.startsWith('>')) {
      const quote: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''))
      flat.push({ block: { kind: 'quote', lines: quote }, source: lines.slice(start, i).join('\n') })
    } else if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]))
      flat.push({ block: { kind: 'table', head, rows }, source: lines.slice(start, i).join('\n') })
    } else if (LIST_RE.test(line)) {
      // One list: items nest by indentation; each top-level item keeps its own source.
      const tops: { item: Item; src: string[] }[] = []
      const stack: Item[] = []
      while (i < lines.length && LIST_RE.test(lines[i])) {
        const [, ws, mark, rest] = lines[i].match(LIST_RE)!
        const indent = Math.floor(ws.replace(/\t/g, '  ').length / 2)
        const box = rest.match(/^\[( |x|X)\]\s+(.*)$/)
        const item: Item = { indent, ordered: /\d/.test(mark), num: /\d/.test(mark) ? parseInt(mark, 10) : undefined, check: box ? box[1] !== ' ' : undefined, text: box ? box[2] : rest, children: [] }
        while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
        if (stack.length) stack[stack.length - 1].children.push(item)
        else tops.push({ item, src: [] })
        stack.push(item)
        tops[tops.length - 1].src.push(lines[i])
        i++
      }
      for (const t of tops) flat.push({ block: { kind: 'item', item: t.item }, source: t.src.join('\n') })
    } else {
      const para: string[] = []
      while (i < lines.length && lines[i].trim() && !/^(```|#{1,6}\s|>)/.test(lines[i]) && !LIST_RE.test(lines[i])) para.push(lines[i++])
      flat.push({ block: { kind: 'para', lines: para }, source: para.join('\n') })
    }
  }
  const hasHeadings = flat.some((f) => f.block.kind === 'heading')
  const segments: Segment[] = []
  for (const f of flat) {
    const last = segments[segments.length - 1]
    // With headings, a section is the unit; without, each top-level block or list item is.
    if (hasHeadings && last && f.block.kind !== 'heading') {
      last.blocks.push(f.block)
      last.source += `\n${f.source}`
    } else segments.push({ source: f.source, blocks: [f.block] })
  }
  return segments
}
