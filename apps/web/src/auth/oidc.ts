import type { AuthProviderProps } from 'react-oidc-context'
import type { AppConfig } from '../config'

export function buildOidcConfig(config: AppConfig): AuthProviderProps {
  return {
    authority: config.cognito.authority,
    client_id: config.cognito.clientId,
    redirect_uri: `${config.appUrl}/login`,
    response_type: 'code',
    scope: 'openid email profile',
    automaticSilentRenew: true,
    loadUserInfo: false,
    // Remove ?code=&state= after the callback is processed; the /login route then navigates in-app.
    onSigninCallback: () => window.history.replaceState({}, document.title, '/login'),
  }
}

/** Skips the Hosted UI provider picker and lands on Google directly. */
export const signinArgs = (returnTo: string) => ({ extraQueryParams: { identity_provider: 'Google' }, state: { returnTo } })

export const logoutUrl = (config: AppConfig) =>
  `${config.cognito.domain}/logout?client_id=${encodeURIComponent(config.cognito.clientId)}&logout_uri=${encodeURIComponent(`${config.appUrl}/`)}`

export function returnToFromState(state: unknown): string {
  const to = (state as { returnTo?: unknown } | undefined)?.returnTo
  return typeof to === 'string' && to.startsWith('/') && !to.startsWith('//') ? to : '/jobs'
}
