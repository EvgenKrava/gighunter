import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAuth } from 'react-oidc-context'
import { returnToFromState } from '../auth/oidc'

export const Route = createFileRoute('/login')({ component: LoginCallback })

function LoginCallback() {
  const auth = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    if (auth.isAuthenticated) void navigate({ to: returnToFromState(auth.user?.state), replace: true })
  }, [auth.isAuthenticated, auth.user?.state, navigate])

  if (auth.error) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-semibold">Sign-in failed</h1>
        <p className="mt-2 text-sm text-slate-600">{auth.error.message}</p>
        <a className="mt-4 inline-block min-h-11 rounded-lg bg-brand px-4 py-2 text-white" href="/">Try again</a>
      </main>
    )
  }
  return <main className="p-6 text-slate-600">Signing you in…</main>
}
