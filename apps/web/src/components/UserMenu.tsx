import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { LogOut, User, UserCog } from 'lucide-react'

const itemClass = 'flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'

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
          <Link to="/profile" role="menuitem" className={itemClass} onClick={() => setOpen(false)}>
            <User size={16} />Profile
          </Link>
          <Link to="/account" role="menuitem" className={itemClass} onClick={() => setOpen(false)}>
            <UserCog size={16} />Account
          </Link>
          <button type="button" role="menuitem" className={itemClass} onClick={() => { setOpen(false); onSignOut() }}>
            <LogOut size={16} />Sign out
          </button>
          <p className="mt-1 border-t border-slate-200 px-2 pt-2 text-xs text-slate-500 dark:border-slate-700">
            <Link to="/terms" className="underline" onClick={() => setOpen(false)}>Terms</Link> · <Link to="/privacy" className="underline" onClick={() => setOpen(false)}>Privacy</Link>
          </p>
        </div>
      )}
    </div>
  )
}
