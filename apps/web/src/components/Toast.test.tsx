import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ToastProvider, useToast } from './Toast'

function Probe() {
  const toast = useToast()
  return <button onClick={() => toast('Saved', 'success')}>go</button>
}
describe('Toast', () => {
  it('shows a toast and removes it after 4 s', () => {
    vi.useFakeTimers()
    render(<ToastProvider><Probe /></ToastProvider>)
    act(() => screen.getByText('go').click())
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    act(() => vi.advanceTimersByTime(4100))
    expect(screen.queryByRole('status')).toBeNull()
    vi.useRealTimers()
  })
})
