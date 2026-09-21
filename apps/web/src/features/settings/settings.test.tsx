import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { defaultSettings } from '@gighunter/core/schema'
import { renderWithProviders, setAuth, mockAuth } from '../../test/utils'
import { CostControls } from './CostControls'
import { TelegramBlock } from './TelegramBlock'
import { FreelancerBlock } from './FreelancerBlock'
import type { PublicSettings } from '../../api/hooks'

const base = (): PublicSettings => defaultSettings('2026-09-21T10:00:00.000Z')
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('CostControls', () => {
  it('patches active and pollIntervalMinutes', async () => {
    const onPatch = vi.fn()
    renderWithProviders(<CostControls settings={base()} onPatch={onPatch} />)
    await userEvent.click(screen.getByRole('switch', { name: /job search/i }))
    expect(onPatch).toHaveBeenCalledWith({ active: true })
    await userEvent.selectOptions(screen.getByLabelText(/poll every/i), '60')
    expect(onPatch).toHaveBeenCalledWith({ pollIntervalMinutes: 60 })
  })
})

describe('TelegramBlock', () => {
  beforeEach(() => setAuth(mockAuth()))
  it('saves a token via PUT and clears the input', async () => {
    const fetchFn = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { ...base(), telegram: { tokenSet: true, tokenHint: 'abcd', botUsername: 'gh_bot' } }))
    renderWithProviders(<TelegramBlock settings={base()} onPatch={vi.fn()} />)
    await userEvent.type(screen.getByPlaceholderText(/123456789:/), '123456789:secret-abcd')
    await userEvent.click(screen.getByRole('button', { name: /save token/i }))
    await waitFor(() => expect(fetchFn).toHaveBeenCalled())
    expect(String(fetchFn.mock.calls[0]![0])).toBe('https://api.test/settings/telegram/token')
    expect((fetchFn.mock.calls[0]![1] as RequestInit).method).toBe('PUT')
    fetchFn.mockRestore()
  })
  it('shows status when connected, removes after confirm, sends a test', async () => {
    const s: PublicSettings = { ...base(), telegram: { tokenSet: true, tokenHint: 'abcd', botUsername: 'gh_bot', chatId: '-100', chatTitle: 'My gigs' } }
    const fetchFn = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    renderWithProviders(<TelegramBlock settings={s} onPatch={vi.fn()} />)
    expect(screen.getByText(/@gh_bot/)).toBeInTheDocument()
    expect(screen.getByText(/My gigs/)).toBeInTheDocument()
    expect(screen.getByText(/···abcd/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /send test message/i }))
    await waitFor(() => expect(String(fetchFn.mock.calls[0]![0])).toBe('https://api.test/settings/telegram/test'))
    await userEvent.click(screen.getByRole('button', { name: /remove/i }))
    await userEvent.click(screen.getByRole('button', { name: /^remove token$/i }))
    await waitFor(() => expect(fetchFn.mock.calls.some((c) => (c[1] as RequestInit).method === 'DELETE')).toBe(true))
    fetchFn.mockRestore()
  })
})

describe('FreelancerBlock', () => {
  beforeEach(() => setAuth(mockAuth()))
  it('toggles enabled and saves the query on blur', async () => {
    const onPatch = vi.fn()
    const s: PublicSettings = { ...base(), platforms: { freelancer: { enabled: false, query: 'react', tokenSet: true, tokenHint: '1234', connectedAs: 'yev' }, upwork: { enabled: false } } }
    renderWithProviders(<FreelancerBlock settings={s} onPatch={onPatch} />)
    expect(screen.getByText(/connected as yev/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch', { name: /poll freelancer/i }))
    expect(onPatch).toHaveBeenCalledWith({ platforms: { freelancer: { enabled: true } } })
    const q = screen.getByLabelText(/search query/i)
    await userEvent.clear(q); await userEvent.type(q, 'typescript'); await userEvent.tab()
    expect(onPatch).toHaveBeenCalledWith({ platforms: { freelancer: { query: 'typescript' } } })
  })
})
