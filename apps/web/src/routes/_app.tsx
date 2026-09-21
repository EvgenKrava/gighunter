import { createFileRoute, Navigate, Outlet, useLocation } from '@tanstack/react-router'
import { useAuthUser } from '../auth/useAuthUser'
import { AppShell } from '../components/AppShell'

export const Route = createFileRoute('/_app')({ component: AppGuard })

function AppGuard() {
  const { user, isLoading } = useAuthUser()
  const location = useLocation()
  if (isLoading) return <main className="p-6 text-slate-600">Loading…</main>
  if (!user) {
    // Remember where the user wanted to go (e.g. a job link tapped in Telegram), then bounce via the landing page.
    sessionStorage.setItem('returnTo', location.pathname)
    return <Navigate to="/" replace />
  }
  return (
    <AppShell user={user}>
      <Outlet />
    </AppShell>
  )
}
