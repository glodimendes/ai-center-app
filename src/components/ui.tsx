import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '@/lib/util'

export function Button({
  children,
  onClick,
  kind = 'default',
  disabled,
  title,
  label,
  className
}: {
  children?: ReactNode
  /** Text after the icon; hidden when the view is narrow (it stays in the tooltip). */
  label?: string
  onClick?: () => void
  kind?: 'default' | 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  title?: string
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 px-2.5 h-7 rounded-md whitespace-nowrap text-[12.5px] font-medium transition-colors disabled:opacity-40',
        kind === 'primary' && 'bg-accent text-white hover:opacity-90',
        kind === 'default' && 'bg-panel border border-line hover:bg-sunken',
        kind === 'ghost' && 'text-muted hover:text-ink hover:bg-sunken',
        kind === 'danger' && 'text-danger hover:bg-danger/10',
        className
      )}
    >
      {children}
      {label && <span className="@max-4xl:hidden">{label}</span>}
    </button>
  )
}

export function Header({ title, children, sub }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="drag-region h-14 shrink-0 flex items-center gap-3 px-5 @max-3xl:px-3 border-b border-line">
      <div className="min-w-0 flex-1">
        <h1 className="text-[15px] font-semibold leading-tight truncate">{title}</h1>
        {sub && <div className="text-[11.5px] text-muted leading-tight truncate @max-2xl:hidden">{sub}</div>}
      </div>
      <div className="no-drag flex shrink-0 items-center gap-2 @max-3xl:gap-1">{children}</div>
    </header>
  )
}

const escapeStack: { current: () => void }[] = []
let escapeListening = false

/** Esc closes only the most recently opened modal or popover, not every layer at once. */
export function useEscape(onEscape: () => void, active = true) {
  const ref = useRef(onEscape)
  ref.current = onEscape
  useEffect(() => {
    if (!active) return
    if (!escapeListening) {
      escapeListening = true
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !escapeStack.length) return
        e.preventDefault()
        escapeStack[escapeStack.length - 1].current()
      })
    }
    escapeStack.push(ref)
    return () => {
      const i = escapeStack.lastIndexOf(ref)
      if (i >= 0) escapeStack.splice(i, 1)
    }
  }, [active])
}

export function Modal({ children, onClose, width = 'max-w-lg' }: { children: ReactNode; onClose: () => void; width?: string }) {
  useEscape(onClose)
  return (
    <div className="fixed inset-0 z-40 bg-black/30 flex items-start justify-center p-4 pt-[min(12vh,6rem)]" onMouseDown={onClose}>
      <div className={cx('w-full max-h-full overflow-y-auto bg-panel rounded-xl shadow-2xl border border-line', width)} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

/**
 * Small popover anchored to its parent element, rendered in a portal so scrolling lists can't clip it.
 * It flips up or shifts sideways to stay inside the window.
 */
export function Popover({ children, onClose, className, align = 'left' }: { children: ReactNode; onClose: () => void; className?: string; align?: 'left' | 'right' }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<CSSProperties>({ top: 0, left: 0, visibility: 'hidden' })
  useLayoutEffect(() => {
    const place = () => {
      const host = anchor.current?.parentElement
      const el = ref.current
      if (!host || !el) return
      const r = host.getBoundingClientRect()
      const m = 8
      const w = el.offsetWidth
      const left = Math.max(m, Math.min(align === 'right' ? r.right - w : r.left, window.innerWidth - w - m))
      const below = window.innerHeight - r.bottom - m - 4
      const above = r.top - m - 4
      const up = el.scrollHeight > below && above > below
      const maxHeight = Math.max(120, up ? above : below)
      setPos(up ? { left, bottom: window.innerHeight - r.top + 4, maxHeight } : { left, top: r.bottom + 4, maxHeight })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [align])
  useEffect(() => {
    // The trigger lives in the same wrapper; let its own click toggle instead of close-then-reopen.
    // Clicks inside another popover (one opened from this one) don't count as outside.
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element
      if (ref.current?.contains(t) || anchor.current?.parentElement?.contains(t) || t.closest?.('[data-popover]')) return
      onClose()
    }
    setTimeout(() => window.addEventListener('mousedown', onDown))
    return () => window.removeEventListener('mousedown', onDown)
  }, [onClose])
  useEscape(onClose)
  return (
    <>
      <span ref={anchor} hidden />
      {createPortal(
        <div ref={ref} data-popover style={pos} className={cx('fixed z-50 overflow-y-auto bg-panel border border-line rounded-lg shadow-xl p-2', className)}>
          {children}
        </div>,
        document.body
      )}
    </>
  )
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={cx('inline-block w-2 h-2 rounded-full shrink-0', className)} style={{ background: color }} />
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-muted text-[12.5px] py-10 text-center">{children}</div>
}

/** Crescent moon with "z"s, like Apple's sleep symbol: a postponed task. */
export function MoonZzz({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M11 4a7.5 7.5 0 1 0 9 9 6 6 0 0 1-9-9Z" />
      <path d="M15 2.5h4l-4 4h4" strokeWidth={1.7} />
    </svg>
  )
}
