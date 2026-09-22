import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { routeTree } from '../routeTree.gen'
import { ToastProvider } from '../components/Toast'
import { mockAuth, setAuth, testConfig, type MockAuth } from '../test/utils'

function renderAt(path: string) {
  const router = createRouter({ routeTree, context: { config: testConfig }, history: createMemoryHistory({ initialEntries: [path] }) })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <ToastProvider><RouterProvider router={router} /></ToastProvider>
    </QueryClientProvider>,
  )
  return router
}

describe('Account page', () => {
  let auth: MockAuth
  const assign = vi.fn()
  beforeEach(() => {
    auth = mockAuth()
    setAuth(auth)
    Object.defineProperty(window, 'location', { value: { ...window.location, assign, origin: 'https://app.test' }, writable: true })
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows the Google identity and a link to manage it; no password controls', async () => {
    renderAt('/account')
    await screen.findByRole('heading', { name: /^account$/i })
    expect(screen.getByText(/signed in with google/i)).toBeInTheDocument()
    expect(screen.getByText('me@example.com')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /manage google account/i })).toHaveAttribute('href', 'https://myaccount.google.com/security')
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /password/i })).not.toBeInTheDocument()
  })

  it('deletes the account only after confirmation, then signs the user out', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    renderAt('/account')
    await userEvent.click(await screen.findByRole('button', { name: /delete account/i }))
    expect(fetchSpy).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /delete account/i }))
    await userEvent.click(screen.getByRole('button', { name: /delete everything/i }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(String(url)).toBe('https://api.test/me')
    expect((init as RequestInit).method).toBe('DELETE')
    await waitFor(() => expect(auth.removeUser).toHaveBeenCalled())
    expect(assign).toHaveBeenCalledWith(expect.stringContaining('/logout'))
  })

  it('reports a failure and keeps the account', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'internal error' }), { status: 500, headers: { 'content-type': 'application/json' } }))
    renderAt('/account')
    await userEvent.click(await screen.findByRole('button', { name: /delete account/i }))
    await userEvent.click(screen.getByRole('button', { name: /delete everything/i }))
    await screen.findByRole('status')
    expect(auth.removeUser).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /delete account/i })).toBeEnabled()
  })
})

describe('Legal pages', () => {
  beforeEach(() => setAuth(mockAuth({ isAuthenticated: false, user: undefined })))

  it.each([
    ['/terms', /terms of service/i],
    ['/privacy', /privacy policy/i],
  ])('%s renders signed out and names the contact address', async (path, heading) => {
    renderAt(path)
    await screen.findByRole('heading', { name: heading, level: 1 })
    const contacts = screen.getAllByRole('link', { name: 'oldfromkb@gmail.com' })
    expect(contacts.length).toBeGreaterThan(0)
    for (const c of contacts) expect(c).toHaveAttribute('href', 'mailto:oldfromkb@gmail.com')
  })

  it('landing page footer links to both', async () => {
    renderAt('/')
    await screen.findByRole('button', { name: /sign in with google/i })
    expect(screen.getByRole('link', { name: /terms/i })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: /privacy/i })).toHaveAttribute('href', '/privacy')
  })
})
