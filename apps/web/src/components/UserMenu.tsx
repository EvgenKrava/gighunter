import { useEffect, useRef, useState } from 'react'
import { LogOut } from 'lucide-react'

export function UserMenu({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const initial = email ? email[0]!.toUpperCase() : '?'

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="grid h-11 w-11 place-items-center rounded-full bg-indigo-100 font-semibold text-brand dark:bg-indigo-900/40"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {initial}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <p className="truncate px-2 py-1.5 text-sm text-slate-600 dark:text-slate-300" title={email}>{email}</p>
          <button
            type="button"
            role="menuitem"
            className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={() => { setOpen(false); onSignOut() }}
          >
            <LogOut size={16} />Sign out
          </button>
        </div>
      )}
    </div>
  )
}
