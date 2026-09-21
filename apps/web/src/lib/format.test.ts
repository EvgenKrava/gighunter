import { describe, it, expect } from 'vitest'
import { timeAgo, budgetLabel, verdictTone, statusLabel } from './format'

const now = new Date('2026-09-21T12:00:00Z')
describe('format', () => {
  it('timeAgo buckets', () => {
    expect(timeAgo('2026-09-21T11:59:40Z', now)).toBe('just now')
    expect(timeAgo('2026-09-21T11:35:00Z', now)).toBe('25m ago')
    expect(timeAgo('2026-09-21T08:00:00Z', now)).toBe('4h ago')
    expect(timeAgo('2026-09-18T12:00:00Z', now)).toBe('3d ago')
  })
  it('budgetLabel matches the Telegram wording', () => {
    expect(budgetLabel({ min: 150, max: 300, currency: 'USD', type: 'fixed' })).toBe('$150–300 USD fixed')
    expect(budgetLabel({ min: 20, max: 40, currency: 'USD', type: 'hourly' })).toBe('$20–40/h USD hourly')
    expect(budgetLabel({ currency: 'USD', type: 'fixed' })).toBe('$? USD fixed')
    expect(budgetLabel(null)).toBe('budget n/a')
    expect(budgetLabel({ min: 1500, max: 3000, currency: 'AUD', type: 'fixed', rateToUsd: 0.71 })).toBe('$1500–3000 AUD fixed (≈ $1065–2130 USD)')
  })
  it('tones and labels', () => {
    expect(verdictTone('strong')).toBe('green'); expect(verdictTone('maybe')).toBe('amber'); expect(verdictTone('no')).toBe('red'); expect(verdictTone(undefined)).toBe('slate')
    expect(statusLabel('pending')).toBe('Sending')
  })
})
