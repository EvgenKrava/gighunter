import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../test/utils'
import { StatusChips } from './StatusChips'

describe('StatusChips', () => {
  it('renders tabs in spec order with the current one selected', () => {
    renderWithProviders(<StatusChips current="pending" />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Notified', 'Sending', 'Scored', 'Filtered'])
    expect(screen.getByRole('tab', { name: 'Sending' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Notified' })).toHaveAttribute('aria-selected', 'false')
  })
})
