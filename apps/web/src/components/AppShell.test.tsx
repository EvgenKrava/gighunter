import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, setAuth, mockAuth } from '../test/utils'
import { AppShell } from './AppShell'

describe('AppShell', () => {
  it('renders navigation and an account menu with email and sign-out', async () => {
    const auth = mockAuth()
    setAuth(auth)
    Object.defineProperty(window, 'location', { value: { ...window.location, assign: () => {}, origin: 'https://app.test' }, writable: true })
    renderWithProviders(<AppShell user={{ email: 'me@example.com' }}><p>content</p></AppShell>)
    expect(screen.getAllByRole('link', { name: /jobs/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /settings/i }).length).toBeGreaterThan(0)
    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.queryByText('me@example.com')).not.toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: /account menu/i })[0]!)
    expect(screen.getAllByText('me@example.com').length).toBeGreaterThan(0)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('me@example.com')).not.toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: /account menu/i })[0]!)
    await userEvent.click(screen.getByRole('menuitem', { name: /sign out/i }))
    expect(auth.removeUser).toHaveBeenCalled()
  })
})
