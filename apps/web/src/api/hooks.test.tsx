import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders, setAuth, mockAuth } from '../test/utils'
import { useProfile, useMatches } from './hooks'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function ProfileProbe() {
  const q = useProfile()
  return <div>{q.isLoading ? 'loading' : q.data ? q.data.displayName : 'no-profile'}</div>
}
function MatchesProbe() {
  const q = useMatches('notified')
  return <div>{q.data?.pages.flatMap((p) => p.items).map((m) => m.job.title).join(',') ?? 'loading'}</div>
}

describe('hooks', () => {
  beforeEach(() => setAuth(mockAuth()))
  it('useProfile returns null on 404 and sends the ID token', async () => {
    const fetchFn = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(404, { error: 'profile not set' }))
    renderWithProviders(<ProfileProbe />)
    await waitFor(() => expect(screen.getByText('no-profile')).toBeInTheDocument())
    expect((fetchFn.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer tok' })
    fetchFn.mockRestore()
  })
  it('useMatches queries by status', async () => {
    const fetchFn = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { items: [{ job: { title: 'A' } }, { job: { title: 'B' } }] }))
    renderWithProviders(<MatchesProbe />)
    await waitFor(() => expect(screen.getByText('A,B')).toBeInTheDocument())
    expect(String(fetchFn.mock.calls[0]![0])).toBe('https://api.test/matches?status=notified&limit=30')
    fetchFn.mockRestore()
  })
  it('signs out on 401', async () => {
    const auth = mockAuth()
    setAuth(auth)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(401, { error: 'unauthorized' }))
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, assign, origin: 'https://app.test' }, writable: true })
    renderWithProviders(<ProfileProbe />)
    await waitFor(() => expect(auth.removeUser).toHaveBeenCalled())
    expect(assign).toHaveBeenCalledWith(expect.stringContaining('/logout?client_id=cid'))
    vi.restoreAllMocks()
  })
})
