import { describe, it, expect } from 'vitest'
import {
  ProfileInputSchema, SettingsSchema, SettingsPatchSchema, defaultSettings, DEFAULT_MODEL,
  PromptsPatchSchema, JobSchema, MatchSchema, ScoreResultSchema,
} from './index'

const now = '2026-09-20T10:00:00.000Z'

describe('ProfileInputSchema', () => {
  it('accepts a minimal valid profile', () => {
    const r = ProfileInputSchema.safeParse({
      displayName: 'Yev', skills: [{ name: 'TypeScript', level: 'expert' }],
      budget: { min: 50, max: 500, currency: 'USD' }, maxHours: 6, languages: ['en'], stopWords: [], freeText: '',
    })
    expect(r.success).toBe(true)
  })
  it('rejects budget max < min', () => {
    const r = ProfileInputSchema.safeParse({
      displayName: 'Yev', skills: [], budget: { min: 500, max: 50, currency: 'USD' }, maxHours: 6, languages: ['en'], stopWords: [], freeText: '',
    })
    expect(r.success).toBe(false)
  })
})

describe('SettingsSchema', () => {
  it('defaultSettings fills every default', () => {
    const s = defaultSettings(now)
    expect(s).toMatchObject({
      active: false, notifyThreshold: 70, maxJobAgeHours: 24, model: DEFAULT_MODEL, chatModel: DEFAULT_MODEL,
      telegram: { tokenSet: false }, platforms: { freelancer: { enabled: false, query: '', tokenSet: false }, upwork: { enabled: false } }, updatedAt: now,
    })
  })
  it('parses a partial stored item into a full Settings', () => {
    const s = SettingsSchema.parse({ active: true, updatedAt: now })
    expect(s.notifyThreshold).toBe(70)
    expect(s.platforms.freelancer.query).toBe('')
  })
  it('patch rejects unknown keys and out-of-range threshold', () => {
    expect(SettingsPatchSchema.safeParse({ notifyThreshold: 101 }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ telegram: { webhookSecret: 'x' } }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ telegram: { chatId: '-100123' }, platforms: { freelancer: { enabled: true, query: 'react' } } }).success).toBe(true)
  })
})

describe('PromptsPatchSchema', () => {
  it('allows null to reset and limits quick actions to 8 unique labels', () => {
    expect(PromptsPatchSchema.safeParse({ scoring: null }).success).toBe(true)
    const nine = Array.from({ length: 9 }, (_, i) => ({ label: `a${i}`, text: 't' }))
    expect(PromptsPatchSchema.safeParse({ quickActions: nine }).success).toBe(false)
    const dup = [{ label: 'a', text: 't' }, { label: 'a', text: 'u' }]
    expect(PromptsPatchSchema.safeParse({ quickActions: dup }).success).toBe(false)
  })
})

describe('JobSchema / MatchSchema / ScoreResultSchema', () => {
  const job = {
    platform: 'freelancer', externalId: '123', url: 'https://www.freelancer.com/projects/x', title: 'T', description: 'D',
    budget: { min: 100, max: 200, currency: 'USD', type: 'fixed' }, skills: ['react'], postedAt: now,
  }
  it('accepts a job with null budget', () => {
    expect(JobSchema.safeParse({ ...job, budget: null }).success).toBe(true)
  })
  it('score must be an int in 0..100 and risks ≤ 4', () => {
    expect(ScoreResultSchema.safeParse({ score: 82, reasoning: 'ok', estimatedHours: 3, risks: [] }).success).toBe(true)
    expect(ScoreResultSchema.safeParse({ score: 101, reasoning: 'ok', estimatedHours: 3, risks: [] }).success).toBe(false)
    expect(ScoreResultSchema.safeParse({ score: 10, reasoning: 'ok', estimatedHours: 3, risks: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false)
  })
  it('match requires status and ttl', () => {
    expect(MatchSchema.safeParse({ job, status: 'pending', createdAt: now, ttl: 1 }).success).toBe(true)
    expect(MatchSchema.safeParse({ job, status: 'sent', createdAt: now, ttl: 1 }).success).toBe(false)
  })
})
