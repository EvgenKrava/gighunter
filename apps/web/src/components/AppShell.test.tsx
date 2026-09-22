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

  it('keeps Profile in the account menu, not in the main navigation', async () => {
    setAuth(mockAuth())
    renderWithProviders(<AppShell user={{ email: 'me@example.com' }}><p>content</p></AppShell>)
    expect(screen.queryByRole('link', { name: /profile/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: /account menu/i })[0]!)
    const profile = screen.getByRole('menuitem', { name: /profile/i })
    expect(profile).toHaveAttribute('href', '/profile')
    await userEvent.click(profile)
    expect(screen.queryByRole('menuitem', { name: /profile/i })).not.toBeInTheDocument()
  })

  it('account menu offers Account, and links to Terms and Privacy', async () => {
    setAuth(mockAuth())
    renderWithProviders(<AppShell user={{ email: 'me@example.com' }}><p>content</p></AppShell>)
    await userEvent.click(screen.getAllByRole('button', { name: /account menu/i })[0]!)
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Profile', 'Account', 'Sign out'])
    expect(screen.getByRole('menuitem', { name: /account/i })).toHaveAttribute('href', '/account')
    expect(screen.getByRole('link', { name: /terms/i })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: /privacy/i })).toHaveAttribute('href', '/privacy')
  })
})
