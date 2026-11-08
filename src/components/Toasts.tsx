import { useStore } from '@/store/app'
import { cx } from '@/lib/util'

export function Toasts() {
  const { toasts, dismiss } = useStore()
  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={cx(
            'max-w-sm text-left px-3.5 py-2.5 rounded-lg shadow-lg border text-[12.5px]',
            t.kind === 'error' ? 'bg-panel border-danger/40 text-danger' : 'bg-ink text-bg border-transparent'
          )}
        >
          {t.text}
        </button>
      ))}
    </div>
  )
}
