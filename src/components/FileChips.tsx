import { FileText, X } from 'lucide-react'
import { cx } from '@/lib/util'

const name = (p: string) => p.split('/').filter(Boolean).pop() ?? p

/** Attached files as small chips. With `onRemove` they are editable (composer); without, they decorate a sent message. */
export function FileChips({ files, onRemove, className }: { files: string[]; onRemove?: (path: string) => void; className?: string }) {
  if (!files.length) return null
  return (
    <div className={cx('flex flex-wrap gap-1.5', className)}>
      {files.map((f) => (
        <span key={f} title={f} className="inline-flex items-center gap-1.5 max-w-[16rem] rounded-full border border-line bg-bg px-2.5 py-0.5 text-[12px] text-muted">
          <FileText size={12} className="shrink-0" />
          <span className="truncate">{name(f)}</span>
          {onRemove && (
            <button onClick={() => onRemove(f)} title="Remove" className="shrink-0 hover:text-danger">
              <X size={12} />
            </button>
          )}
        </span>
      ))}
    </div>
  )
}
