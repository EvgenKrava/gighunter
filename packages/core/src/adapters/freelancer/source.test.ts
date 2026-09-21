import { describe, it, expect, vi } from 'vitest'
import { FreelancerSource } from './source'
import { SourceError } from '../types'
import fixture from './__fixtures__/projects-active.json'

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

describe('FreelancerSource.fetchRecent', () => {
  it('calls the active projects endpoint with auth header and normalizes', async () => {
    const fetchFn = vi.fn().mockResolvedValue(json(fixture))
    const src = new FreelancerSource(fetchFn)
    const jobs = await src.fetchRecent({ query: 'react', since: new Date('2026-09-20T00:00:00Z'), token: 'TOK' })
    const [url, init] = fetchFn.mock.calls[0]!
    expect(String(url)).toMatch(/^https:\/\/www\.freelancer\.com\/api\/projects\/0\.1\/projects\/active\/\?/)
    expect(String(url)).toContain('query=react')
    expect(String(url)).toContain('from_time=1789862400')
    expect(init.headers).toMatchObject({ 'freelancer-oauth-v1': 'TOK' })
    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toMatchObject({
      platform: 'freelancer', externalId: '39876543', url: 'https://www.freelancer.com/projects/nextjs/Fix-Stripe-webhook-retries-39876543',
      title: 'Fix Stripe webhook retries in Next.js app', budget: { min: 150, max: 300, currency: 'USD', type: 'fixed' },
      skills: ['Next.js', 'Stripe'], postedAt: '2026-09-20T09:20:00.000Z', language: 'en',
      client: { country: 'United States', rating: 4.8, reviews: 12, paymentVerified: true },
    })
    expect(jobs[0]!.budget?.rateToUsd).toBe(1)
    expect(jobs[1]!.budget).toEqual({ min: 15, max: 25, currency: 'INR', type: 'hourly', rateToUsd: 0.0104 })
  })
  it('throws SourceError rate_limited with retryAfter on 429', async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ status: 'error' }, 429, { 'retry-after': '30' }))
    const err = await new FreelancerSource(fetchFn).fetchRecent({ query: '', since: new Date(), token: 't' }).catch((e) => e)
    expect(err).toBeInstanceOf(SourceError)
    expect(err.code).toBe('rate_limited')
    expect(err.retryAfterSec).toBe(30)
  })
  it('throws SourceError http_<status> on other failures', async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ status: 'error', message: 'bad token' }, 401))
    const err = await new FreelancerSource(fetchFn).fetchRecent({ query: '', since: new Date(), token: 't' }).catch((e) => e)
    expect(err.code).toBe('http_401')
  })
})

describe('FreelancerSource.verifyToken', () => {
  it('returns username on success and error otherwise', async () => {
    const okFetch = vi.fn().mockResolvedValue(json({ status: 'success', result: { id: 1, username: 'yev' } }))
    expect(await new FreelancerSource(okFetch).verifyToken('t')).toEqual({ ok: true, username: 'yev' })
    expect(String(okFetch.mock.calls[0]![0])).toBe('https://www.freelancer.com/api/users/0.1/self/')
    const badFetch = vi.fn().mockResolvedValue(json({ status: 'error', message: 'Unauthorized' }, 401))
    expect(await new FreelancerSource(badFetch).verifyToken('t')).toEqual({ ok: false, error: 'http_401' })
  })
})
