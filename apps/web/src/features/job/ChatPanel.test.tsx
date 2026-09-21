import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, setAuth, mockAuth } from '../../test/utils'
import { ChatPanel } from './ChatPanel'

const ref = { platform: 'freelancer' as const, externalId: 'sample-1' }
const quick = [{ label: 'Draft proposal', text: 'Draft a proposal please' }]
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const chat = { messages: [{ role: 'user' as const, content: 'hi', at: '2026-09-21T10:00:00.000Z' }, { role: 'assistant' as const, content: '**Hello** there', at: '2026-09-21T10:00:01.000Z' }], usage: { inputTokens: 1, outputTokens: 1 }, createdAt: 'x', updatedAt: 'x', ttl: 1 }

describe('ChatPanel', () => {
  beforeEach(() => setAuth(mockAuth()))
  it('renders history with markdown, sends a quick action, disables input while pending', async () => {
    let resolve!: (r: Response) => void
    const fetchFn = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((r) => { resolve = r }))
    renderWithProviders(<ChatPanel matchRef={ref} chat={chat} quickActions={quick} />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Draft proposal' }))
    expect(screen.getByPlaceholderText(/ask about this job/i)).toBeDisabled()
    expect(screen.getByText('Draft a proposal please')).toBeInTheDocument() // optimistic echo
    const body = JSON.parse(String(fetchFn.mock.calls[0]![1]!.body))
    expect(body).toEqual({ message: 'Draft a proposal please' })
    expect(String(fetchFn.mock.calls[0]![0])).toBe('https://api.test/matches/freelancer/sample-1/chat')
    resolve(json(200, { reply: 'Here you go', truncated: true, usage: { inputTokens: 1, outputTokens: 1 } }))
    await waitFor(() => expect(screen.getByPlaceholderText(/ask about this job/i)).not.toBeDisabled())
    expect(screen.getByText(/reply was cut off/i)).toBeInTheDocument()
    fetchFn.mockRestore()
  })
  it('sends typed text with Enter and resets after confirmation', async () => {
    const fetchFn = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { reply: 'ok', truncated: false, usage: { inputTokens: 1, outputTokens: 1 } }))
    renderWithProviders(<ChatPanel matchRef={ref} chat={chat} quickActions={[]} />)
    await userEvent.type(screen.getByPlaceholderText(/ask about this job/i), 'Estimate it{enter}')
    await waitFor(() => expect(fetchFn).toHaveBeenCalled())
    expect(JSON.parse(String(fetchFn.mock.calls[0]![1]!.body))).toEqual({ message: 'Estimate it' })
    fetchFn.mockResolvedValue(new Response(null, { status: 204 }))
    await userEvent.click(screen.getByRole('button', { name: /reset chat/i }))
    await userEvent.click(screen.getByRole('button', { name: /^reset$/i }))
    await waitFor(() => expect(fetchFn.mock.calls.some((c) => (c[1] as RequestInit).method === 'DELETE')).toBe(true))
    fetchFn.mockRestore()
  })
})
