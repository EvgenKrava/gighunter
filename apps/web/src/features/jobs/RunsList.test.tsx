import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RunsList } from './RunsList'

describe('RunsList', () => {
  it('renders per-platform counts, usage and errors', () => {
    render(<RunsList runs={[{ startedAt: '2026-09-21T10:00:00.000Z', finishedAt: '2026-09-21T10:00:20.000Z', trigger: 'schedule', perPlatform: { freelancer: { fetched: 12, new: 3, filtered: 1, scored: 2, notified: 1 } }, usage: { inputTokens: 4000, outputTokens: 300 }, errors: ['score_cap:freelancer:2_skipped'], ttl: 1 }]} />)
    expect(screen.getByText('freelancer')).toBeInTheDocument()
    expect(screen.getByText(/12 fetched · 3 new · 1 filtered · 2 scored · 1 notified/)).toBeInTheDocument()
    expect(screen.getByText(/4\.3k tokens/)).toBeInTheDocument()
    expect(screen.getByText(/1 issue/)).toBeInTheDocument()
  })
  it('empty state', () => {
    render(<RunsList runs={[]} />)
    expect(screen.getByText(/no runs yet/i)).toBeInTheDocument()
  })
})
