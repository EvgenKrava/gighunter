import { describe, it, expect } from 'vitest'
import { preFilter } from './preFilter'
import type { Job } from '../schema/index'

const now = new Date('2026-09-20T12:00:00.000Z')
const profile = { stopWords: ['wordpress', 'long term'], languages: ['en'], budget: { min: 50, max: 500, currency: 'USD' as const } }
const javaProfile = { ...profile, stopWords: ['java', 'long term'] }
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
]

describe('preFilter', () => {
  it.each(cases)('%s', (_name, patch, expected, prof) => {
    expect(preFilter({ ...base, ...patch }, prof, settings, now)).toBe(expected)
  })
})
