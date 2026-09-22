import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRouteWithContext, createRoute, createRouter, RouterContextProvider } from '@tanstack/react-router'
import { vi } from 'vitest'
import type { AppConfig } from '../config'
import { ToastProvider } from '../components/Toast'

export const testConfig: AppConfig = { apiUrl: 'https://api.test', appUrl: 'https://app.test', cognito: { authority: 'https://cognito.test/pool', clientId: 'cid', domain: 'https://auth.test' } }

export type MockUser = { id_token: string; profile: { sub: string; email?: string }; state?: unknown; expires_at?: number; refresh_token?: string }
export type MockAuth = { isAuthenticated: boolean; isLoading: boolean; error?: Error; user?: MockUser; signinRedirect: ReturnType<typeof vi.fn>; signinSilent: ReturnType<typeof vi.fn>; removeUser: ReturnType<typeof vi.fn> }

const inAnHour = () => Math.floor(Date.now() / 1000) + 3600
export function mockAuth(overrides: Partial<MockAuth> = {}): MockAuth {
  return { isAuthenticated: true, isLoading: false, user: { id_token: 'tok', profile: { sub: 'u1', email: 'me@example.com' }, expires_at: inAnHour(), refresh_token: 'rt' }, signinRedirect: vi.fn(), signinSilent: vi.fn(), removeUser: vi.fn(), ...overrides }
}
/** What react-oidc-context reports after a page load finds an expired session: the user is still there, `isAuthenticated` is not. */
export function expiredAuth(overrides: Partial<MockAuth> = {}): MockAuth {
  return mockAuth({ isAuthenticated: false, user: { id_token: 'stale', profile: { sub: 'u1', email: 'me@example.com' }, expires_at: Math.floor(Date.now() / 1000) - 60, refresh_token: 'rt' }, ...overrides })
}

/** Current mock; tests replace it with setAuth(). `react-oidc-context` is mocked in setup.ts to read it. */
export const authState: { current: MockAuth } = { current: mockAuth() }
export const setAuth = (a: MockAuth) => { authState.current = a }

export function renderWithProviders(ui: ReactNode, opts: { route?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  // `RouterContextProvider` (not `RouterProvider`) puts the router into context without rendering
  // `<Matches>`, so `ui` mounts synchronously — `RouterProvider` defers the first paint to a
  // microtask (`router.load()` always `await`s), which is incompatible with tests that assert
  // immediately after `render()` with no `waitFor`/`await` in between.
  const rootRoute = createRootRouteWithContext<{ config: AppConfig }>()({ component: () => null })
  const index = createRoute({ getParentRoute: () => rootRoute, path: '/' })
  const router = createRouter({ routeTree: rootRoute.addChildren([index]), context: { config: testConfig }, history: createMemoryHistory({ initialEntries: [opts.route ?? '/'] }) })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterContextProvider router={router as never}>{ui}</RouterContextProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { ...utils, queryClient, router }
}
