import type { AuthContextProps } from 'react-oidc-context'

let inflight: Promise<string | null> | undefined

/**
 * Exchanges the refresh token for fresh tokens and resolves to the new ID token, or null when the
 * renew failed (react-oidc-context's `signinSilent` reports failure as null plus `auth.error`).
 * Concurrent callers share one exchange: on resume React Query refetches every stale query at once.
 */
export function renewSession(auth: Pick<AuthContextProps, 'signinSilent'>): Promise<string | null> {
  inflight ??= auth
    .signinSilent()
    .then((user) => user?.id_token ?? null)
    .finally(() => { inflight = undefined })
  return inflight
}
