import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { routeTree } from '../routeTree.gen'
import { ToastProvider } from '../components/Toast'
import { mockAuth, setAuth, testConfig } from '../test/utils'

// Uses the real route tree + RouterProvider on purpose: the guard's redirect used to re-issue itself
// on every re-render while the navigation was pending, which spun the router forever (Safari killed
// the page with "A problem repeatedly occurred"). A unit test around a mocked navigate can't see that.
function renderApp(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({ routeTree, context: { config: testConfig }, history: createMemoryHistory({ initialEntries: [initialPath] }) })
  const navigate = vi.spyOn(router, 'navigate')
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { router, navigate }
}

describe('/_app guard', () => {
  it('bounces a signed-out deep link to the landing page exactly once and remembers the full link', async () => {
    setAuth(mockAuth({ isAuthenticated: false, user: undefined }))
    sessionStorage.clear()
    const { router, navigate } = renderApp('/jobs/freelancer/42?tab=chat')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    await screen.findByRole('button', { name: /sign in with google/i })
    expect(sessionStorage.getItem('returnTo')).toBe('/jobs/freelancer/42?tab=chat')
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/', replace: true }))
  })

  it('renders the shell for a signed-in user without navigating away', async () => {
    setAuth(mockAuth())
    sessionStorage.clear()
    const { router, navigate } = renderApp('/settings')
    await screen.findByRole('navigation', { name: /primary/i })
    expect(router.state.location.pathname).toBe('/settings')
    expect(navigate).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('returnTo')).toBeNull()
  })
})
