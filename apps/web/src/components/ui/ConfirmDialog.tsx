import { useEffect } from 'react'
import { Button } from './Button'
export function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', danger, onConfirm, onCancel }: { open: boolean; title: string; body?: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus()
    }
  }, [open, onCancel])

  if (!open) return null
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-4 sm:place-items-center">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900">
        <h2 className="text-lg font-semibold">{title}</h2>
        {body && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{body}</p>}
        <div className="mt-5 flex gap-2">
          <Button autoFocus variant="secondary" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} className="flex-1" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}
