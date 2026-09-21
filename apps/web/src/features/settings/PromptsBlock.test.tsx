import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, setAuth, mockAuth } from '../../test/utils'
import { PromptsBlock } from './PromptsBlock'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const data = { defaults: { scoring: 'DEFAULT SCORING {{profile}}', chat: 'DEFAULT CHAT', quickActions: [{ label: 'Draft proposal', text: 'draft' }] }, overrides: { scoring: 'MY SCORING', updatedAt: 'x' }, placeholders: ['{{profile}}'] }

describe('PromptsBlock', () => {
  beforeEach(() => setAuth(mockAuth()))
  it('shows overrides, resets to default with null, previews', async () => {
    const fetchFn = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url); const m = init?.method ?? 'GET'
      if (u.endsWith('/prompts') && m === 'GET') return json(200, data)
      if (u.endsWith('/prompts') && m === 'PUT') return json(200, { updatedAt: 'y' })
      if (u.endsWith('/prompts/preview')) return json(200, { rendered: 'RENDERED TEXT' })
      return json(404, {})
    })
    renderWithProviders(<PromptsBlock />)
    expect(await screen.findByDisplayValue('MY SCORING')).toBeInTheDocument()
    expect(screen.getByDisplayValue('DEFAULT CHAT')).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: /reset to default/i })[0]!)
    await waitFor(() => expect(fetchFn.mock.calls.some((c) => (c[1] as RequestInit).method === 'PUT' && String((c[1] as RequestInit).body) === '{"scoring":null}')).toBe(true))
    await userEvent.click(screen.getAllByRole('button', { name: /preview/i })[0]!)
    expect(await screen.findByText('RENDERED TEXT')).toBeInTheDocument()
    fetchFn.mockRestore()
  })
  it('quick actions editor caps at 8 and saves the list', async () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ label: `A${i}`, text: `t${i}` }))
    const fetchFn = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).endsWith('/prompts') && (init?.method ?? 'GET') === 'GET') return json(200, { ...data, overrides: { quickActions: eight, updatedAt: 'x' } })
      return json(200, { updatedAt: 'y' })
    })
    renderWithProviders(<PromptsBlock />)
    expect(await screen.findByDisplayValue('A7')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add action/i })).toBeDisabled()
    await userEvent.click(screen.getAllByRole('button', { name: /remove action/i })[0]!)
    await userEvent.click(screen.getByRole('button', { name: /save actions/i }))
    await waitFor(() => expect(fetchFn.mock.calls.some((c) => String((c[1] as RequestInit).body ?? '').includes('"quickActions":[') && !String((c[1] as RequestInit).body).includes('"A0"'))).toBe(true))
    fetchFn.mockRestore()
  })
})
