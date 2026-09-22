import { useEffect, useRef } from 'react'
import { createFileRoute, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { useAuthUser } from '../auth/useAuthUser'
import { AppShell } from '../components/AppShell'
import { FormCardSkeleton, Skeleton, SkeletonPage } from '../components/ui/Skeleton'

export const Route = createFileRoute('/_app')({ component: AppGuard })

function AppGuard() {
  const { user, isLoading } = useAuthUser()
  const { href } = useLocation()
  const navigate = useNavigate()
  // Signed out: remember where the user wanted to go (e.g. a job link tapped in Telegram) and bounce
  // via the landing page. Imperative and once-only on purpose — `<Navigate>` re-issues the navigation
  // on every re-render (props compared by reference), and this component re-renders while that
  // navigation is pending, so it spun the router forever and Safari killed the page.
  const bounced = useRef(false)
  useEffect(() => {
    if (user || isLoading || bounced.current) return
    bounced.current = true
    sessionStorage.setItem('returnTo', href)
    void navigate({ to: '/', replace: true })
  }, [user, isLoading, href, navigate])
  if (!user) {
    return (
      <AppShell>
        <SkeletonPage className="space-y-4">
          <Skeleton className="h-7 w-28" />
          <FormCardSkeleton fields={3} />
        </SkeletonPage>
      </AppShell>
    )
  }
  return (
    <AppShell user={user}>
      <Outlet />
    </AppShell>
  )
}
