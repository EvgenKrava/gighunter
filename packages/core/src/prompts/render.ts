import type { Job, Match, Profile, Prompts, QuickAction } from '../schema/index'
import { APP_CONTEXT, DEFAULT_CHAT_PROMPT, DEFAULT_QUICK_ACTIONS, DEFAULT_SCORING_PROMPT } from './defaults'

export type RenderKey = 'app_context' | 'profile' | 'job' | 'score'
export type RenderBlocks = Partial<Record<RenderKey, string>> & { app_context: string; profile: string }

const HEADINGS: Record<RenderKey, string> = {
  app_context: 'Context',
  profile: 'Developer profile',
  job: 'Job',
  score: "GigHunter's assessment",
}

export function renderTemplate(template: string, blocks: RenderBlocks, required: RenderKey[]): string {
  let out = template
  for (const [key, value] of Object.entries(blocks) as [RenderKey, string | undefined][]) {
    if (value === undefined) continue
    out = out.split(`{{${key}}}`).join(value)
  }
  for (const key of required) {
    if (!template.includes(`{{${key}}}`) && blocks[key] !== undefined) {
      out += `\n\n## ${HEADINGS[key]}\n${blocks[key]}`
    }
  }
  return out
}

const money = (min?: number, max?: number) =>
  min !== undefined && max !== undefined ? `$${min}–${max}` : min !== undefined ? `from $${min}` : max !== undefined ? `up to $${max}` : ''

export function renderProfile(p: Profile): string {
  const skills = p.skills.length ? p.skills.map((s) => `${s.name} (${s.level})`).join(', ') : '(none listed)'
  return [
    `Name: ${p.displayName}`,
    `Skills: ${skills}`,
    `Budget per gig: $${p.budget.min}–${p.budget.max} ${p.budget.currency} (fixed price)`,
    `Max hours per gig: ${p.maxHours}`,
    `Languages: ${p.languages.join(', ')}`,
    `Stop words: ${p.stopWords.length ? p.stopWords.join(', ') : '(none)'}`,
    `About / what I'm looking for:`,
    p.freeText.trim() || '(not provided)',
  ].join('\n')
}

export function renderJob(j: Job): string {
  let budget = 'not specified'
  if (j.budget) {
    const range = money(j.budget.min, j.budget.max)
    budget = j.budget.type === 'hourly' ? `${range}/h ${j.budget.currency} (hourly)` : `${range} ${j.budget.currency} (fixed)`
  }
  const client = j.client
    ? [
        j.client.country && `country ${j.client.country}`,
        j.client.rating !== undefined && `rating ${j.client.rating}`,
        j.client.reviews !== undefined && `${j.client.reviews} reviews`,
        j.client.paymentVerified !== undefined && (j.client.paymentVerified ? 'payment verified' : 'payment NOT verified'),
      ]
        .filter(Boolean)
        .join(', ')
    : 'unknown'
  return [
    `Title: ${j.title}`,
    `Platform: ${j.platform}`,
    `URL: ${j.url}`,
    `Budget: ${budget}`,
    `Skills: ${j.skills.length ? j.skills.join(', ') : '(none listed)'}`,
    `Posted: ${j.postedAt}`,
    `Language: ${j.language ?? 'unknown'}`,
    `Client: ${client || 'unknown'}`,
    `Description:`,
    j.description.trim(),
  ].join('\n')
}

export function renderScore(m: Pick<Match, 'status' | 'filterReason' | 'score' | 'verdict'>): string {
  if (m.status === 'filtered') return `Pre-filter rejected this job (reason: ${m.filterReason ?? 'unknown'}); it was not scored.`
  if (!m.score) return 'Not scored yet.'
  const risks = m.score.risks.length ? m.score.risks.join('; ') : 'none'
  return [
    `Score: ${m.score.score}/100 (${m.verdict ?? 'n/a'})`,
    `Reasoning: ${m.score.reasoning}`,
    `Estimated hours: ${m.score.estimatedHours}`,
    `Risks: ${risks}`,
  ].join('\n')
}

export interface ResolvedPrompts { scoring: string; chat: string; quickActions: QuickAction[] }

export function resolvePrompts(overrides: Prompts | null): ResolvedPrompts {
  return {
    scoring: overrides?.scoring ?? DEFAULT_SCORING_PROMPT,
    chat: overrides?.chat ?? DEFAULT_CHAT_PROMPT,
    quickActions: overrides?.quickActions ?? DEFAULT_QUICK_ACTIONS,
  }
}

export function buildScoringSystemPrompt(template: string, profile: Profile): string {
  return renderTemplate(template, { app_context: APP_CONTEXT, profile: renderProfile(profile) }, ['profile'])
}

export function buildChatSystemPrompt(template: string, profile: Profile, match: Match): string {
  return renderTemplate(
    template,
    { app_context: APP_CONTEXT, profile: renderProfile(profile), job: renderJob(match.job), score: renderScore(match) },
    ['profile', 'job', 'score'],
  )
}

export const SAMPLE_JOB: Job = {
  platform: 'freelancer',
  externalId: 'sample-1',
  url: 'https://www.freelancer.com/projects/sample-1',
  title: 'Fix Stripe webhook retries in a Next.js app',
  description:
    'Our Next.js 14 app receives Stripe webhooks but occasionally double-processes events after retries. Need idempotency keys stored in Postgres (Prisma) and a small test. Repo access provided. Should be a few hours for someone who has done this before.',
  budget: { min: 150, max: 300, currency: 'USD', type: 'fixed' },
  skills: ['Next.js', 'Stripe', 'PostgreSQL'],
  postedAt: '2026-09-20T09:30:00.000Z',
  language: 'en',
  client: { country: 'US', rating: 4.8, reviews: 12, paymentVerified: true },
}

export const SAMPLE_MATCH: Match = {
  job: SAMPLE_JOB,
  status: 'notified',
  score: {
    score: 82,
    reasoning: 'Exact Next.js + Stripe match, closed scope with a clear deliverable and tests.',
    estimatedHours: 3,
    risks: ['Repo state unknown', 'Client may expect ongoing support'],
  },
  verdict: 'strong',
  createdAt: '2026-09-20T09:45:00.000Z',
  scoredAt: '2026-09-20T09:45:05.000Z',
  notifiedAt: '2026-09-20T09:45:06.000Z',
  ttl: 1_763_000_000,
}
