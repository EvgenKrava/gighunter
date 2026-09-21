import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SAMPLE_MATCH } from '@gighunter/core/prompts'
import type { Chat, MatchRef } from '@gighunter/core/schema'
import { renderWithProviders, setAuth, mockAuth } from '../test/utils'
import { useProfile, useMatches, useMatch, useFeedback } from './hooks'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function ProfileProbe() {
  const q = useProfile()
  return <div>{q.isLoading ? 'loading' : q.data ? q.data.displayName : 'no-profile'}</div>
}
function MatchesProbe() {
  const q = useMatches('notified')
  return <div>{q.data?.pages.flatMap((p) => p.items).map((m) => m.job.title).join(',') ?? 'loading'}</div>
}
function MatchesPaginationProbe() {
  const q = useMatches('notified')
  return (
    <div>
      <div>{q.data?.pages.flatMap((p) => p.items).map((m) => m.job.title).join(',') ?? 'loading'}</div>
      <button onClick={() => void q.fetchNextPage()}>more</button>
    </div>
  )
}
function MatchProbe({ ref }: { ref: MatchRef }) {
  const q = useMatch(ref)
  return <div>{q.isLoading ? 'loading' : 'done'}</div>
}
function FeedbackProbe({ ref }: { ref: MatchRef }) {
  const m = useFeedback(ref)
  return <button onClick={() => m.mutate('down')}>feedback-down</button>
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
  it('useMatches appends the next page using the encoded cursor', async () => {
    const user = userEvent.setup()
    const fetchFn = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(200, { items: [{ job: { title: 'A' } }], cursor: 'a b/c' }))
      .mockResolvedValueOnce(json(200, { items: [{ job: { title: 'B' } }] }))
    renderWithProviders(<MatchesPaginationProbe />)
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument())
    await user.click(screen.getByText('more'))
    await waitFor(() => expect(screen.getByText('A,B')).toBeInTheDocument())
    expect(fetchFn.mock.calls).toHaveLength(2)
    expect(String(fetchFn.mock.calls[1]![0])).toBe('https://api.test/matches?status=notified&limit=30&cursor=a%20b%2Fc')
    fetchFn.mockRestore()
  })
  it('useMatch encodes special characters in the external id', async () => {
    const fetchFn = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { match: SAMPLE_MATCH, chat: null }))
    renderWithProviders(<MatchProbe ref={{ platform: 'upwork', externalId: '~01ab/cd' }} />)
    await waitFor(() => expect(screen.getByText('done')).toBeInTheDocument())
    expect(String(fetchFn.mock.calls[0]![0])).toBe('https://api.test/matches/upwork/~01ab%2Fcd')
    fetchFn.mockRestore()
  })
  it('useFeedback merges the returned match into the cache while preserving chat', async () => {
    const user = userEvent.setup()
    const ref: MatchRef = { platform: 'freelancer', externalId: 'sample-1' }
    const chat: Chat = {
      messages: [{ role: 'user', content: 'hi', at: '2026-09-20T10:00:00.000Z' }],
      usage: { inputTokens: 1, outputTokens: 1 },
      createdAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
      ttl: 1_763_000_000,
    }
    const fetchFn = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { ...SAMPLE_MATCH, feedback: 'down' }))
    const { queryClient } = renderWithProviders(<FeedbackProbe ref={ref} />)
    queryClient.setQueryData(['match', 'freelancer', 'sample-1'], { match: SAMPLE_MATCH, chat })
    await waitFor(() => expect(screen.getByText('feedback-down')).toBeInTheDocument())
    await user.click(screen.getByText('feedback-down'))
    await waitFor(() => {
      const cached = queryClient.getQueryData<{ match: typeof SAMPLE_MATCH; chat: Chat }>(['match', 'freelancer', 'sample-1'])
      expect(cached?.match.feedback).toBe('down')
    })
    const cached = queryClient.getQueryData<{ match: typeof SAMPLE_MATCH; chat: Chat }>(['match', 'freelancer', 'sample-1'])
    expect(cached?.chat).toBe(chat)
    expect(String(fetchFn.mock.calls[0]![0])).toBe('https://api.test/matches/freelancer/sample-1/feedback')
    fetchFn.mockRestore()
  })
})
