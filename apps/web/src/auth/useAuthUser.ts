import { useAuth } from 'react-oidc-context'
import { useRouter } from '@tanstack/react-router'
import { logoutUrl, signinArgs } from './oidc'

export interface AuthUser { sub: string; email: string; idToken: string }

export function useAuthUser() {
  const auth = useAuth()
  const { config } = useRouter().options.context
  const profile = auth.user?.profile
  const user: AuthUser | null =
    auth.isAuthenticated && auth.user?.id_token && typeof profile?.sub === 'string'
      ? { sub: profile.sub, email: typeof profile.email === 'string' ? profile.email : '', idToken: auth.user.id_token }
      : null
  return {
    user,
    isLoading: auth.isLoading,
    error: auth.error,
    signIn: (returnTo = '/jobs') => void auth.signinRedirect(signinArgs(returnTo)),
    signOut: () => {
      void auth.removeUser()
      window.location.assign(logoutUrl(config))
    },
  }
}
