import { JobSchema, type Job } from '../../schema/index'

export interface FreelancerProject {
  id: number
  owner_id?: number
  title: string
  seo_url?: string
  currency?: { code?: string; exchange_rate?: number | null }
  description?: string
  preview_description?: string
  jobs?: { name: string }[]
  submitdate?: number
  time_updated?: number
  type?: string
  budget?: { minimum?: number | null; maximum?: number | null }
  language?: string
}

export interface FreelancerUser {
  location?: { country?: { name?: string } }
  status?: { payment_verified?: boolean }
  employer_reputation?: { entire_history?: { overall?: number; reviews?: number } }
}

export function normalizeFreelancerProject(p: FreelancerProject, users: Record<string, FreelancerUser>): Job {
  const owner = p.owner_id !== undefined ? users[String(p.owner_id)] : undefined
  const type = p.type === 'hourly' ? 'hourly' : 'fixed'
  const budget = p.budget
    ? {
        ...(p.budget.minimum != null ? { min: p.budget.minimum } : {}),
        ...(p.budget.maximum != null ? { max: p.budget.maximum } : {}),
        currency: p.currency?.code ?? 'USD',
        type,
        ...(typeof p.currency?.exchange_rate === 'number' && p.currency.exchange_rate > 0 ? { rateToUsd: p.currency.exchange_rate } : {}),
      }
    : null
  const posted = p.submitdate ?? p.time_updated ?? Math.floor(Date.now() / 1000)
  const reputation = owner?.employer_reputation?.entire_history
  return JobSchema.parse({
    platform: 'freelancer',
    externalId: String(p.id),
    url: p.seo_url ? `https://www.freelancer.com/projects/${p.seo_url}` : `https://www.freelancer.com/projects/${p.id}`,
    title: p.title,
    description: p.description ?? p.preview_description ?? '',
    budget,
    skills: (p.jobs ?? []).map((j) => j.name),
    postedAt: new Date(posted * 1000).toISOString(),
    ...(p.language ? { language: p.language } : {}),
    ...(owner
      ? {
          client: {
            ...(owner.location?.country?.name ? { country: owner.location.country.name } : {}),
            ...(reputation?.overall !== undefined ? { rating: reputation.overall } : {}),
            ...(reputation?.reviews !== undefined ? { reviews: reputation.reviews } : {}),
            ...(owner.status?.payment_verified !== undefined ? { paymentVerified: owner.status.payment_verified } : {}),
          },
        }
      : {}),
  })
}
