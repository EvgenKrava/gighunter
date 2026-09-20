import type { Job, Profile, Settings } from '../schema/index'

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Cheap deterministic rejection before any LLM call. Rules run in order; first hit wins.
 * Returns null when the job should be scored.
 */
export function preFilter(
  job: Job,
  profile: Pick<Profile, 'stopWords' | 'languages' | 'budget'>,
  settings: Pick<Settings, 'maxJobAgeHours'>,
  now: Date,
): string | null {
  const ageMs = now.getTime() - new Date(job.postedAt).getTime()
  if (ageMs > settings.maxJobAgeHours * 3_600_000) return 'stale'

  const haystack = `${job.title}\n${job.description}`
  for (const word of profile.stopWords) {
    const trimmed = word.trim()
    if (!trimmed) continue
    const re = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, 'i')
    if (re.test(haystack)) return `stop_word:${trimmed.toLowerCase()}`
  }

  if (job.language && !profile.languages.map((l) => l.toLowerCase()).includes(job.language.toLowerCase())) return 'language'

  if (job.budget && job.budget.type === 'fixed') {
    if (job.budget.max !== undefined && job.budget.max < profile.budget.min) return 'budget_below_min'
    if (job.budget.min !== undefined && job.budget.min > profile.budget.max) return 'budget_above_max'
  }
  return null
}
