import type { Job, Profile, Settings } from '../schema/index'

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const wordRe = (word: string) => new RegExp(`\\b${escapeRegExp(word.trim())}\\b`, 'i')

/**
 * Cheap deterministic rejection before any LLM call. Rules run in order; first hit wins.
 * Returns null when the job should be scored.
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

  if (job.budget?.type === 'fixed') {
    if (job.budget.max !== undefined && job.budget.max < profile.budget.min) return 'budget_below_min'
    if (job.budget.min !== undefined && job.budget.min > profile.budget.max) return 'budget_above_max'
  }
  if (job.budget?.type === 'hourly' && f.minHourlyRate !== undefined) {
    if (job.budget.max !== undefined && job.budget.max < f.minHourlyRate) return 'hourly_rate_below_min'
  }

  const keywords = f.mustHaveAny.filter((k) => k.trim())
  if (keywords.length && !keywords.some((k) => wordRe(k).test(haystack))) return 'keyword_missing'

  if (f.requirePaymentVerified && job.client?.paymentVerified !== true) return 'payment_not_verified'
  if (f.minClientRating !== undefined && (job.client?.rating ?? 0) < f.minClientRating) return 'client_rating_below_min'
  if (f.minClientReviews !== undefined && (job.client?.reviews ?? 0) < f.minClientReviews) return 'client_reviews_below_min'

  return null
}
