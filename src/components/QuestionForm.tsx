import { useState } from 'react'
import type { ChatQuestion } from '@shared/agents'
import { cx } from '@/lib/util'
import { Button } from './ui'

/** The reply the agent gets: one line per question, its short label and the chosen answers. */
export function answerText(qs: ChatQuestion[], picked: string[][], other: string[]): string {
  return qs
    .map((q, i) => {
      const a = [...picked[i], other[i]?.trim()].filter(Boolean).join(', ')
      const label = q.header || q.question
      return !a ? '' : qs.length === 1 ? a : label.endsWith('?') ? `${label} ${a}` : `${label}: ${a}`
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * Questions with choices an agent asked (its ```questions block), like the question form of the CLI. One single-choice question
 * answers on click; otherwise pick, optionally write your own, and Send. The reply is an ordinary next message.
 */
export function QuestionForm({ questions, onAnswer, disabled }: { questions: ChatQuestion[]; onAnswer: (text: string) => Promise<unknown>; disabled?: boolean }) {
  const [picked, setPicked] = useState<string[][]>(questions.map(() => []))
  const [other, setOther] = useState<string[]>(questions.map(() => ''))
  const [sending, setSending] = useState(false)
  const quick = questions.length === 1 && !questions[0].multiSelect
  const send = async (p = picked, o = other) => {
    const text = answerText(questions, p, o)
    if (!text || sending) return
    setSending(true)
    try {
      await onAnswer(text)
    } finally {
      setSending(false)
    }
  }
  const choose = (i: number, label: string) => {
    const q = questions[i]
    const toggle = (cur: string[]) => (q.multiSelect ? (cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]) : [label])
    // Functional update: two quick clicks on different questions must not overwrite each other.
    setPicked((prev) => prev.map((p, j) => (j === i ? toggle(p) : p)))
    if (quick) void send([[label]], other)
  }
  const ready = questions.some((_, i) => picked[i].length || other[i].trim())
  return (
    <div className="mt-2 rounded-2xl border border-line bg-panel px-4 py-3 space-y-3">
      {questions.map((q, i) => (
        <div key={i}>
          <div className="text-[13.5px] font-medium">{q.question}</div>
          {q.multiSelect && <div className="text-[11.5px] text-faint">Pick any</div>}
          <div className="mt-1.5 flex flex-col gap-1">
            {q.options.map((o) => (
              <button
                key={o.label}
                disabled={disabled || sending}
                onClick={() => choose(i, o.label)}
                className={cx('text-left rounded-xl border px-3 py-1.5 text-[13px] disabled:opacity-50', picked[i].includes(o.label) ? 'border-accent bg-accent-soft' : 'border-line hover:bg-sunken/60')}
              >
                <span>{o.label}</span>
                {o.description && <span className="block text-[12px] text-muted">{o.description}</span>}
              </button>
            ))}
            <input
              value={other[i]}
              disabled={disabled || sending}
              onChange={(e) => setOther(other.map((x, j) => (j === i ? e.target.value : x)))}
              onKeyDown={(e) => e.key === 'Enter' && void send()}
              placeholder="Or write your own…"
              className="rounded-xl border border-line bg-bg px-3 py-1.5 text-[13px] outline-none focus:border-accent"
            />
          </div>
        </div>
      ))}
      {(!quick || other[0].trim()) && (
        <div className="flex justify-end">
          <Button kind="primary" disabled={!ready || disabled || sending} onClick={() => void send()}>
            Send answers
          </Button>
        </div>
      )}
    </div>
  )
}
