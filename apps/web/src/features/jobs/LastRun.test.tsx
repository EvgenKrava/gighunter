import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import type { Run } from '@gighunter/core/schema'
import { renderWithProviders } from '../../test/utils'
import { LastRun } from './LastRun'

const run = (over: Partial<Run> = {}): Run => ({
  startedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
  trigger: 'schedule',
  perPlatform: { freelancer: { fetched: 12, new: 3, filtered: 1, scored: 2, notified: 1 }, upwork: { fetched: 4, new: 2, filtered: 0, scored: 2, notified: 0 } },
  usage: { inputTokens: 100, outputTokens: 10 },
  errors: [],
  ttl: 1,
  ...over,
})

describe('LastRun', () => {
  it('summarises the latest run across platforms and links to Activity', () => {
    renderWithProviders(<LastRun runs={[run(), run({ startedAt: '2026-09-20T00:00:00.000Z' })]} />)
    const link = screen.getByRole('link', { name: /last search 12m ago · 5 new · 1 notified/i })
    expect(link).toHaveAttribute('href', '/activity')
    expect(screen.queryByText(/issue/)).not.toBeInTheDocument()
  })
  it('flags issues of the latest run', () => {
    renderWithProviders(<LastRun runs={[run({ errors: ['a', 'b'] })]} />)
    expect(screen.getByRole('link', { name: /2 issues/i })).toHaveAttribute('href', '/activity')
  })
  it('invites a first search when there are no runs', () => {
    renderWithProviders(<LastRun runs={[]} />)
    expect(screen.getByRole('link', { name: /no searches yet/i })).toHaveAttribute('href', '/activity')
  })
  it('renders nothing while runs are loading', () => {
    renderWithProviders(<LastRun runs={undefined} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText(/search/i)).not.toBeInTheDocument()
  })
})
