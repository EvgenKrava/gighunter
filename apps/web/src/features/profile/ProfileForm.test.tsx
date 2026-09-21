import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileForm } from './ProfileForm'

describe('ProfileForm', () => {
  it('blocks submit with a visible error when the name is empty', async () => {
    const onSubmit = vi.fn()
    render(<ProfileForm initial={null} onSubmit={onSubmit} saving={false} />)
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/displayName/i)
    expect(onSubmit).not.toHaveBeenCalled()
  })
  it('submits a parsed payload with skills, tags and filters', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ProfileForm initial={null} onSubmit={onSubmit} saving={false} />)
    await userEvent.type(screen.getByLabelText(/display name/i), 'Yev')
    await userEvent.click(screen.getByRole('button', { name: /add skill/i }))
    await userEvent.type(screen.getByPlaceholderText(/skill name/i), 'TypeScript')
    await userEvent.selectOptions(screen.getByLabelText(/level/i), 'expert')
    await userEvent.type(screen.getByPlaceholderText(/add a stop word/i), 'wordpress{enter}')
    await userEvent.type(screen.getByPlaceholderText(/add a keyword/i), 'react{enter}')
    await userEvent.click(screen.getByRole('switch', { name: /payment-verified/i }))
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      displayName: 'Yev', skills: [{ name: 'TypeScript', level: 'expert' }], stopWords: ['wordpress'], languages: ['en'],
      budget: { min: 50, max: 500, currency: 'USD' }, filters: { mustHaveAny: ['react'], requirePaymentVerified: true, jobTypes: ['fixed', 'hourly'] },
    })
  })
  it('rejects budget max below min with a form-level error', async () => {
    const onSubmit = vi.fn()
    render(<ProfileForm initial={null} onSubmit={onSubmit} saving={false} />)
    await userEvent.type(screen.getByLabelText(/display name/i), 'Yev')
    const max = screen.getByLabelText(/max budget/i)
    await userEvent.clear(max); await userEvent.type(max, '10')
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/budget/i)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
