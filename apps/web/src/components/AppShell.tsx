import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Briefcase, Settings, User } from 'lucide-react'
import { useAuthUser } from '../auth/useAuthUser'
import { UserMenu } from './UserMenu'

const nav = [
  { to: '/jobs', label: 'Jobs', Icon: Briefcase },
  { to: '/profile', label: 'Profile', Icon: User },
  { to: '/settings', label: 'Settings', Icon: Settings },
] as const

export function AppShell({ user, children }: { user: { email: string }; children: ReactNode }) {
  const { signOut } = useAuthUser()
  const linkClass = 'rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 [&.active]:bg-indigo-50 [&.active]:text-brand dark:text-slate-300 dark:hover:bg-slate-800'
  return (
    <div className="min-h-dvh">
      {/* Desktop header */}
      <header className="sticky top-0 z-40 hidden border-b border-slate-200 bg-white/90 backdrop-blur md:block dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2">
          <Link to="/jobs" search={{ status: 'notified' }} className="mr-4 text-lg font-semibold text-brand">GigHunter</Link>
          {nav.map(({ to, label }) => <Link key={to} to={to} className={linkClass}>{label}</Link>)}
          <div className="ml-auto">
            <UserMenu email={user.email} onSignOut={signOut} />
          </div>
        </div>
      </header>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center gap-2 border-b border-slate-200 bg-white/90 px-4 py-2 backdrop-blur md:hidden dark:border-slate-800 dark:bg-slate-950/90">
        <Link to="/jobs" search={{ status: 'notified' }} className="text-lg font-semibold text-brand">GigHunter</Link>
        <div className="ml-auto">
          <UserMenu email={user.email} onSignOut={signOut} />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-4 md:pb-8">{children}</main>
      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden dark:border-slate-800 dark:bg-slate-950" aria-label="Primary">
        {nav.map(({ to, label, Icon }) => (
          <Link key={to} to={to} className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-slate-500 [&.active]:text-brand">
            <Icon size={22} />{label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
