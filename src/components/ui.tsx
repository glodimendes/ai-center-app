import { useEffect, useRef, type ReactNode } from 'react'
import { cx } from '@/lib/util'

export function Button({
  children,
  onClick,
  kind = 'default',
  disabled,
  title,
  className
}: {
  children: ReactNode
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
      title={title}
      className={cx(
        'inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[12.5px] font-medium transition-colors disabled:opacity-40',
        kind === 'primary' && 'bg-accent text-white hover:opacity-90',
        kind === 'default' && 'bg-panel border border-line hover:bg-sunken',
        kind === 'ghost' && 'text-muted hover:text-ink hover:bg-sunken',
        kind === 'danger' && 'text-danger hover:bg-danger/10',
        className
      )}
    >
      {children}
    </button>
  )
}

export function Header({ title, children, sub }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="drag-region h-14 shrink-0 flex items-center gap-3 px-5 border-b border-line">
      <div className="min-w-0">
        <h1 className="text-[15px] font-semibold leading-tight">{title}</h1>
        {sub && <div className="text-[11.5px] text-muted leading-tight">{sub}</div>}
      </div>
      <div className="flex-1" />
      <div className="no-drag flex items-center gap-2">{children}</div>
    </header>
  )
}

export function Modal({ children, onClose, width = 'max-w-lg' }: { children: ReactNode; onClose: () => void; width?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 bg-black/30 grid place-items-start pt-[12vh]" onMouseDown={onClose}>
      <div className={cx('w-full mx-auto bg-panel rounded-xl shadow-2xl border border-line', width)} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

/** Small anchored popover that closes on outside click / Escape. */
export function Popover({ children, onClose, className }: { children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    setTimeout(() => window.addEventListener('mousedown', onDown))
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div ref={ref} className={cx('absolute z-30 mt-1 bg-panel border border-line rounded-lg shadow-xl p-2', className)}>
      {children}
    </div>
  )
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={cx('inline-block w-2 h-2 rounded-full shrink-0', className)} style={{ background: color }} />
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-muted text-[12.5px] py-10 text-center">{children}</div>
}
