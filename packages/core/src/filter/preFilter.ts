import type { Job, JobBudget, Profile, Settings } from '../schema/index'

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const wordRe = (word: string) => new RegExp(`\\b${escapeRegExp(word.trim())}\\b`, 'i')

/** Budget bounds in USD, or null when the currency cannot be converted (the LLM judges those). */
export function budgetInUsd(b: JobBudget): { min?: number; max?: number } | null {
  const rate = b.currency.toUpperCase() === 'USD' ? 1 : b.rateToUsd
  if (!rate) return null
  return {
    ...(b.min !== undefined ? { min: b.min * rate } : {}),
    ...(b.max !== undefined ? { max: b.max * rate } : {}),
  }
}

/**
 * Cheap deterministic rejection before any LLM call. Rules run in order; first hit wins.
 * Returns null when the job should be scored. Client-quality rules only fire when the platform
 * actually reports the client field — unknown clients pass through to the LLM.
 */
export function preFilter(
  job: Job,
  profile: Pick<Profile, 'stopWords' | 'languages' | 'budget' | 'filters'>,
  settings: Pick<Settings, 'maxJobAgeHours'>,
  now: Date,
): string | null {
  const f = profile.filters
  const ageMs = now.getTime() - new Date(job.postedAt).getTime()
  if (ageMs > settings.maxJobAgeHours * 3_600_000) return 'stale'

  const haystack = `${job.title}\n${job.description}`
  for (const word of profile.stopWords) {
    if (word.trim() && wordRe(word).test(haystack)) return `stop_word:${word.trim().toLowerCase()}`
  }

  if (job.language && !profile.languages.map((l) => l.toLowerCase()).includes(job.language.toLowerCase())) return 'language'

  if (job.budget && !f.jobTypes.includes(job.budget.type)) return `job_type:${job.budget.type}`

  const usd = job.budget ? budgetInUsd(job.budget) : null
  if (usd && job.budget?.type === 'fixed') {
    if (usd.max !== undefined && usd.max < profile.budget.min) return 'budget_below_min'
    if (usd.min !== undefined && usd.min > profile.budget.max) return 'budget_above_max'
  }
  if (usd && job.budget?.type === 'hourly' && f.minHourlyRate !== undefined) {
    if (usd.max !== undefined && usd.max < f.minHourlyRate) return 'hourly_rate_below_min'
  }

  const keywords = f.mustHaveAny.filter((k) => k.trim())
  if (keywords.length && !keywords.some((k) => wordRe(k).test(haystack))) return 'keyword_missing'

  const c = job.client
  if (f.requirePaymentVerified && c?.paymentVerified === false) return 'payment_not_verified'
  if (f.minClientRating !== undefined && c?.rating !== undefined && c.rating < f.minClientRating) return 'client_rating_below_min'
  if (f.minClientReviews !== undefined && c?.reviews !== undefined && c.reviews < f.minClientReviews) return 'client_reviews_below_min'

  return null
}
