import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { routeTree } from '../routeTree.gen'
import { ToastProvider } from '../components/Toast'
import { mockAuth, setAuth, testConfig } from '../test/utils'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const runs = [{ startedAt: new Date(Date.now() - 5 * 60_000).toISOString(), trigger: 'manual', perPlatform: { freelancer: { fetched: 9, new: 2, filtered: 0, scored: 2, notified: 1 } }, usage: { inputTokens: 1200, outputTokens: 100 }, errors: [], ttl: 1 }]

function renderAt(path: string) {
  const router = createRouter({ routeTree, context: { config: testConfig }, history: createMemoryHistory({ initialEntries: [path] }) })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider><RouterProvider router={router} /></ToastProvider>
    </QueryClientProvider>,
  )
  return router
}

describe('Jobs and Activity pages', () => {
  beforeEach(() => {
    setAuth(mockAuth())
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/runs') return json(runs)
      if (url.pathname === '/matches') return json({ items: [] })
      return json({ error: 'not found' }, 404)
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('Jobs shows the feed with a last-search line and no runs section or Run now button', async () => {
    renderAt('/jobs?status=notified')
    await screen.findByRole('link', { name: /last search 5m ago · 2 new · 1 notified/i })
    expect(screen.getAllByRole('tab')).toHaveLength(4)
    expect(screen.queryByRole('heading', { name: /recent runs/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/9 fetched/)).not.toBeInTheDocument()
    expect(within(screen.getByRole('main')).queryByRole('button', { name: /run search now/i })).not.toBeInTheDocument()
  })

  it('Activity shows Run now and the runs list', async () => {
    renderAt('/activity')
    await screen.findByRole('heading', { name: /activity/i, level: 1 })
    expect(screen.getByRole('button', { name: /run search now/i })).toBeInTheDocument()
    await screen.findByText(/9 fetched · 2 new · 0 filtered · 2 scored · 1 notified/)
  })

  it('bottom navigation offers Jobs · Activity · Profile · Settings', async () => {
    renderAt('/activity')
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Jobs', 'Activity', 'Profile', 'Settings'])
    expect(within(nav).getByRole('link', { name: 'Activity' })).toHaveAttribute('href', '/activity')
    await waitFor(() => expect(within(nav).getByRole('link', { name: 'Activity' })).toHaveClass('active'))
  })
})
