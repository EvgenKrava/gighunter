import { describe, it, expect } from 'vitest'
import { renderWithProviders, setAuth, mockAuth, expiredAuth } from '../test/utils'
import { useAuthUser } from './useAuthUser'

function Probe() {
  const { user, isLoading } = useAuthUser()
  return <pre>{JSON.stringify({ user, isLoading })}</pre>
}
const read = () => JSON.parse(document.querySelector('pre')!.textContent!) as { user: { idToken: string; expiresAt: number } | null; isLoading: boolean }

describe('useAuthUser', () => {
  it('exposes the token and its expiry for a signed-in session', () => {
    const auth = mockAuth()
    setAuth(auth)
    renderWithProviders(<Probe />)
    expect(read().user).toEqual({ sub: 'u1', email: 'me@example.com', idToken: 'tok', expiresAt: auth.user!.expires_at })
  })
  it('keeps an expired session that still holds a refresh token as the user — it is renewable, not signed out', () => {
    setAuth(expiredAuth())
    renderWithProviders(<Probe />)
    expect(read().user?.idToken).toBe('stale')
  })
  it('treats an expired session as signed out once a renew has failed', () => {
    setAuth(expiredAuth({ error: new Error('Renew silent failed') }))
    renderWithProviders(<Probe />)
    expect(read().user).toBeNull()
  })
  it('treats an expired session without a refresh token as signed out', () => {
    const a = expiredAuth()
    delete a.user!.refresh_token
    setAuth(a)
    renderWithProviders(<Probe />)
    expect(read().user).toBeNull()
  })
  it('is signed out with no session', () => {
    setAuth(mockAuth({ isAuthenticated: false, user: undefined }))
    renderWithProviders(<Probe />)
    expect(read().user).toBeNull()
  })
})
