import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRouteWithContext, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { vi } from 'vitest'
import type { AppConfig } from '../config'
import { ToastProvider } from '../components/Toast'

export const testConfig: AppConfig = { apiUrl: 'https://api.test', appUrl: 'https://app.test', cognito: { authority: 'https://cognito.test/pool', clientId: 'cid', domain: 'https://auth.test' } }

export type MockAuth = { isAuthenticated: boolean; isLoading: boolean; error?: Error; user?: { id_token: string; profile: { sub: string; email?: string }; state?: unknown }; signinRedirect: ReturnType<typeof vi.fn>; removeUser: ReturnType<typeof vi.fn> }

export function mockAuth(overrides: Partial<MockAuth> = {}): MockAuth {
  return { isAuthenticated: true, isLoading: false, user: { id_token: 'tok', profile: { sub: 'u1', email: 'me@example.com' } }, signinRedirect: vi.fn(), removeUser: vi.fn(), ...overrides }
}

/** Current mock; tests replace it with setAuth(). `react-oidc-context` is mocked in setup.ts to read it. */
export const authState: { current: MockAuth } = { current: mockAuth() }
export const setAuth = (a: MockAuth) => { authState.current = a }

export function renderWithProviders(ui: ReactNode, opts: { route?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const rootRoute = createRootRouteWithContext<{ config: AppConfig }>()({ component: () => ui as never })
  const index = createRoute({ getParentRoute: () => rootRoute, path: '/' })
  const router = createRouter({ routeTree: rootRoute.addChildren([index]), context: { config: testConfig }, history: createMemoryHistory({ initialEntries: [opts.route ?? '/'] }) })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router as never} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { ...utils, queryClient, router }
}
