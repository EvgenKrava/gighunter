import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../test/utils'
import { MatchCard } from './MatchCard'
import { SAMPLE_MATCH } from '@gighunter/core/prompts'

describe('MatchCard', () => {
  it('shows score, verdict, title, budget, reasoning and links to the detail page', () => {
    renderWithProviders(<MatchCard match={{ ...SAMPLE_MATCH, feedback: 'up' }} />)
    expect(screen.getByText('82')).toBeInTheDocument()
    expect(screen.getByText(/strong/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Fix Stripe webhook/ })).toHaveAttribute('href', '/jobs/freelancer/sample-1')
    expect(screen.getByText('$150–300 USD fixed · Freelancer')).toBeInTheDocument()
    expect(screen.getByText(/Exact Next.js/)).toBeInTheDocument()
    expect(screen.getByLabelText('Marked useful')).toBeInTheDocument()
  })
  it('shows the filter reason for filtered jobs', () => {
    renderWithProviders(<MatchCard match={{ ...SAMPLE_MATCH, status: 'filtered', score: undefined, verdict: undefined, filterReason: 'stop_word:wordpress' }} />)
    expect(screen.getByText(/stop_word:wordpress/)).toBeInTheDocument()
  })
})
