import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { routeTree } from '../routeTree.gen'
import { ToastProvider } from '../components/Toast'
import { mockAuth, setAuth, testConfig } from '../test/utils'

function renderAt(path: string) {
  const router = createRouter({ routeTree, context: { config: testConfig }, history: createMemoryHistory({ initialEntries: [path] }) })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider><RouterProvider router={router} /></ToastProvider>
    </QueryClientProvider>,
  )
}

describe('skeleton loading states', () => {
  beforeEach(() => {
    setAuth(mockAuth())
    // The API never answers, so every page stays in its loading state.
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))
  })
  afterEach(() => vi.restoreAllMocks())

  it.each([
    ['/jobs?status=notified', /jobs/i],
    ['/activity', /activity/i],
    ['/profile', /profile/i],
    ['/settings', /settings/i],
  ])('%s keeps its heading and shows a skeleton instead of a spinner', async (path, heading) => {
    renderAt(path)
    await screen.findByRole('status', { name: /loading/i })
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    expect(document.querySelector('.animate-spin')).toBeNull()
  })

  it('the job page keeps the back link and shows header and chat bones', async () => {
    renderAt('/jobs/freelancer/abc')
    await screen.findByRole('status', { name: /loading/i })
    expect(screen.getByRole('link', { name: /all jobs/i })).toBeInTheDocument()
    expect(document.querySelector('.animate-spin')).toBeNull()
  })

  it('the auth gate shows the shell with a skeleton page instead of plain text', async () => {
    setAuth(mockAuth({ isAuthenticated: false, isLoading: true, user: undefined }))
    renderAt('/jobs?status=notified')
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    expect(within(nav).getByRole('link', { name: 'Jobs' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument()
    expect(screen.queryByText(/^loading…$/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /account menu/i })).not.toBeInTheDocument()
  })
})
