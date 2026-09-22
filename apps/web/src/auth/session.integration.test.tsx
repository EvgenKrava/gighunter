import { useEffect, useRef, useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRouteWithContext, createRoute, createRouter, RouterContextProvider } from '@tanstack/react-router'
import { AuthProvider } from 'react-oidc-context'
import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts'
import { testConfig } from '../test/utils'
import { useApi } from '../api/hooks'
import { useAuthUser } from './useAuthUser'

// The real libraries, not the setup.ts mock: this pins the behaviour the app works around —
// oidc-client-ts never starts a silent renew for a session that is already expired when it loads.
vi.unmock('react-oidc-context')

const authority = testConfig.cognito.authority
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '')
const jwt = (claims: Record<string, unknown>) => `${b64({ alg: 'RS256', kid: 'k' })}.${b64(claims)}.sig`
const now = () => Math.floor(Date.now() / 1000)

// Like the /_app guard, only mount the API consumer once a user exists; it then makes one call.
function Probe() {
  const { user } = useAuthUser()
  return user ? <Caller /> : <pre>no-user</pre>
}
function Caller() {
  const api = useApi()
  const [out, setOut] = useState('pending')
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    api.get<{ ok: string }>('/profile').then((r) => setOut(r.ok), (e: Error) => setOut(`error:${e.message}`))
  }, [api])
  return <pre>{out}</pre>
}

describe('session renew against the real oidc libraries', () => {
  afterEach(() => { localStorage.clear(); vi.unstubAllGlobals() })

  it('a page load with an expired session and a refresh token renews it and calls the API with the new token', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/.well-known/openid-configuration')) return Response.json({ issuer: authority, token_endpoint: `${testConfig.cognito.domain}/oauth2/token`, authorization_endpoint: `${testConfig.cognito.domain}/oauth2/authorize` })
      if (url.endsWith('/oauth2/token')) {
        const body = new URLSearchParams(String(init?.body))
        expect(body.get('grant_type')).toBe('refresh_token')
        expect(body.get('refresh_token')).toBe('rt')
        expect(body.get('client_id')).toBe('cid')
        return Response.json({ id_token: jwt({ sub: 'u1', iss: authority, aud: 'cid', exp: now() + 3600, auth_time: 1 }), access_token: 'at2', expires_in: 3600, token_type: 'Bearer' })
      }
      if (url === `${testConfig.apiUrl}/profile`) {
        const auth = (init?.headers as Record<string, string>).authorization
        return auth === `Bearer ${jwt({ sub: 'u1', iss: authority, aud: 'cid', exp: now() + 3600, auth_time: 1 })}` ? Response.json({ ok: 'fresh-token-accepted' }) : Response.json({ message: 'Unauthorized' }, { status: 401 })
      }
      throw new Error(`unexpected fetch ${url}`)
    }))
    const userManager = new UserManager({ authority, client_id: 'cid', redirect_uri: `${testConfig.appUrl}/login`, automaticSilentRenew: true, userStore: new WebStorageStateStore({ store: localStorage }) })
    await userManager.storeUser(new User({ id_token: jwt({ sub: 'u1', iss: authority, aud: 'cid', exp: now() - 3600, auth_time: 1 }), access_token: 'at1', refresh_token: 'rt', token_type: 'Bearer', expires_at: now() - 3600, profile: { sub: 'u1', email: 'me@example.com' } as never, scope: 'openid email profile' }))

    const rootRoute = createRootRouteWithContext<{ config: typeof testConfig }>()({ component: () => null })
    const router = createRouter({ routeTree: rootRoute.addChildren([createRoute({ getParentRoute: () => rootRoute, path: '/' })]), context: { config: testConfig }, history: createMemoryHistory({ initialEntries: ['/'] }) })
    render(
      <AuthProvider userManager={userManager}>
        <QueryClientProvider client={new QueryClient()}>
          <RouterContextProvider router={router as never}><Probe /></RouterContextProvider>
        </QueryClientProvider>
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText(/fresh-token-accepted/)).toBeInTheDocument())
    expect(calls.filter((u) => u.endsWith('/oauth2/token'))).toHaveLength(1)
    expect(calls.filter((u) => u.endsWith('/profile'))).toHaveLength(1)
    const stored = await userManager.getUser()
    expect(stored?.expired).toBe(false)
    expect(stored?.refresh_token).toBe('rt') // Cognito does not rotate it; the library keeps the old one
    userManager.stopSilentRenew()
  })
})
