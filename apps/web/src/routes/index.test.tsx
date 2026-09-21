import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, setAuth, mockAuth } from '../test/utils'
import { Landing } from './index'

describe('Landing', () => {
  it('offers Google sign-in when signed out and passes returnTo', async () => {
    const auth = mockAuth({ isAuthenticated: false, user: undefined })
    setAuth(auth)
    sessionStorage.setItem('returnTo', '/jobs/freelancer/1')
    renderWithProviders(<Landing />)
    expect(screen.getByText(/evening-gig radar/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    expect(auth.signinRedirect).toHaveBeenCalledWith(expect.objectContaining({ state: { returnTo: '/jobs/freelancer/1' } }))
    expect(sessionStorage.getItem('returnTo')).toBeNull()
  })
  it('shows Open app when signed in', () => {
    setAuth(mockAuth())
    renderWithProviders(<Landing />)
    expect(screen.getByRole('link', { name: /open app/i })).toHaveAttribute('href', '/jobs')
  })
})
