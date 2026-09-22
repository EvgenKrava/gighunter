import { useCallback } from 'react'
import { useAuth } from 'react-oidc-context'
import { useRouter } from '@tanstack/react-router'
import { logoutUrl, signinArgs } from './oidc'
import { renewSession } from './session'

export interface AuthUser { sub: string; email: string; idToken: string; expiresAt: number }

export function useAuthUser() {
  const auth = useAuth()
  const { config } = useRouter().options.context
  const session = auth.user
  const profile = session?.profile
  // A page load that finds an expired session gets `isAuthenticated: false`, but while a refresh token
  // is there the session is renewable, not gone: the API layer renews it on the next request. Only a
  // failed renew (`auth.error`) turns it into a signed-out state.
  const live = auth.isAuthenticated || (!!session?.refresh_token && !auth.error)
  const user: AuthUser | null =
    live && session?.id_token && typeof profile?.sub === 'string'
      ? { sub: profile.sub, email: typeof profile.email === 'string' ? profile.email : '', idToken: session.id_token, expiresAt: session.expires_at ?? 0 }
      : null
  const { signinSilent } = auth
  const renew = useCallback(() => renewSession({ signinSilent }), [signinSilent])
  return {
    user,
    isLoading: auth.isLoading,
    error: auth.error,
    /** Fresh ID token, or null when the refresh token no longer works. */
    renew,
    signIn: (returnTo = '/jobs') => void auth.signinRedirect(signinArgs(returnTo)),
    signOut: () => {
      void auth.removeUser()
      window.location.assign(logoutUrl(config))
    },
  }
}
