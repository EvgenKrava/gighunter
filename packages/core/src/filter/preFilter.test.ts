import { describe, it, expect } from 'vitest'
import { preFilter, budgetInUsd } from './preFilter'
import { defaultProfileFilters, type Job, type ProfileFilters } from '../schema/index'

const now = new Date('2026-09-20T12:00:00.000Z')
const profile = { stopWords: ['wordpress', 'long term'], languages: ['en'], budget: { min: 50, max: 500, currency: 'USD' as const }, filters: defaultProfileFilters() }
const javaProfile = { ...profile, stopWords: ['java', 'long term'] }
const withFilters = (f: Partial<ProfileFilters>) => ({ ...profile, filters: { ...defaultProfileFilters(), ...f } })
const settings = { maxJobAgeHours: 24 }
const base: Job = {
  platform: 'freelancer', externalId: '1', url: 'https://x.test/1', title: 'Build a React widget', description: 'Small task',
  budget: { min: 100, max: 200, currency: 'USD', type: 'fixed' }, skills: [], postedAt: '2026-09-20T10:00:00.000Z', language: 'en',
}

const cases: [string, Partial<Job>, string | null, typeof profile][] = [
  ['passes a good job', {}, null, profile],
  ['stale: older than maxJobAgeHours', { postedAt: '2026-09-18T10:00:00.000Z' }, 'stale', profile],
  ['stop word in title, case-insensitive', { title: 'WordPress plugin fix' }, 'stop_word:wordpress', profile],
  ['stop phrase in description', { description: 'Looking for a Long Term partner' }, 'stop_word:long term', profile],
  ['stop word must match whole words (java vs javascript)', { title: 'javascript', description: '' }, null, javaProfile],
  ['language not in profile', { language: 'de' }, 'language', profile],
  ['unknown language passes', { language: undefined }, null, profile],
  ['fixed budget max below profile min', { budget: { min: 10, max: 30, currency: 'USD', type: 'fixed' } }, 'budget_below_min', profile],
  ['fixed budget min above profile max', { budget: { min: 600, max: 900, currency: 'USD', type: 'fixed' } }, 'budget_above_max', profile],
  ['hourly budget is not checked', { budget: { min: 5, max: 10, currency: 'USD', type: 'hourly' } }, null, profile],
  ['null budget is not checked', { budget: null }, null, profile],
  ['stale wins over stop word (order)', { postedAt: '2026-09-01T00:00:00.000Z', title: 'wordpress' }, 'stale', profile],
  ['job type not allowed', { budget: { min: 20, max: 40, currency: 'USD', type: 'hourly' } }, 'job_type:hourly', withFilters({ jobTypes: ['fixed'] })],
  ['hourly rate below floor', { budget: { min: 10, max: 15, currency: 'USD', type: 'hourly' } }, 'hourly_rate_below_min', withFilters({ minHourlyRate: 20 })],
  ['hourly rate at/above floor passes', { budget: { min: 10, max: 25, currency: 'USD', type: 'hourly' } }, null, withFilters({ minHourlyRate: 20 })],
  ['required keyword missing', {}, 'keyword_missing', withFilters({ mustHaveAny: ['typescript', 'node'] })],
  ['required keyword present (whole word, case-insensitive)', { description: 'Needs TypeScript expertise' }, null, withFilters({ mustHaveAny: ['typescript'] })],
  ['unknown client passes even when verification is required', {}, null, withFilters({ requirePaymentVerified: true })],
  ['client explicitly unverified is rejected', { client: { paymentVerified: false } }, 'payment_not_verified', withFilters({ requirePaymentVerified: true })],
  ['rating rule skipped when the platform reports no rating', { client: { paymentVerified: true } }, null, withFilters({ minClientRating: 4 })],
  ['INR budget converted with rateToUsd (₹12500–37500 ≈ $130–390) passes a $50–500 profile', { budget: { min: 12500, max: 37500, currency: 'INR', type: 'fixed', rateToUsd: 0.0104 } }, null, profile],
  ['INR budget converted and above max', { budget: { min: 250000, max: 500000, currency: 'INR', type: 'fixed', rateToUsd: 0.0104 } }, 'budget_above_max', profile],
  ['non-USD budget without a rate skips budget rules', { budget: { min: 250000, max: 500000, currency: 'INR', type: 'fixed' } }, null, profile],
  ['hourly floor uses the converted rate', { budget: { min: 750, max: 1250, currency: 'INR', type: 'hourly', rateToUsd: 0.0104 } }, 'hourly_rate_below_min', withFilters({ minHourlyRate: 20 })],
  ['payment verified passes', { client: { paymentVerified: true } }, null, withFilters({ requirePaymentVerified: true })],
  ['client rating below min', { client: { rating: 3.9 } }, 'client_rating_below_min', withFilters({ minClientRating: 4 })],
  ['client reviews below min', { client: { rating: 5, reviews: 2 } }, 'client_reviews_below_min', withFilters({ minClientReviews: 5 })],
  ['client filters pass', { client: { rating: 4.8, reviews: 12, paymentVerified: true } }, null, withFilters({ requirePaymentVerified: true, minClientRating: 4, minClientReviews: 5 })],
]

describe('preFilter', () => {
  it.each(cases)('%s', (_name, patch, expected, prof) => {
    expect(preFilter({ ...base, ...patch }, prof, settings, now)).toBe(expected)
  })

  it('budgetInUsd converts or returns null', () => {
    expect(budgetInUsd({ min: 100, max: 200, currency: 'USD', type: 'fixed' })).toEqual({ min: 100, max: 200 })
    expect(budgetInUsd({ min: 1000, max: 2000, currency: 'EUR', type: 'fixed', rateToUsd: 1.1 })).toEqual({ min: 1100, max: 2200 })
    expect(budgetInUsd({ min: 1000, currency: 'EUR', type: 'fixed' })).toBeNull()
  })
})
