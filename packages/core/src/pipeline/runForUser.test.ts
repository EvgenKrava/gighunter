import { describe, it, expect, vi } from 'vitest'
import { defaultProfileFilters } from '../schema/index'
import { runForUser, MAX_SCORED_PER_RUN, type PipelineDeps } from './runForUser'
import { defaultSettings, type Job, type Match } from '../schema/index'
import { SourceError } from '../adapters/index'
import { createLogger } from '../logger'

const nowIso = '2026-09-20T12:00:00.000Z'
const profile = { displayName: 'Yev', skills: [{ name: 'React', level: 'expert' as const }], budget: { min: 50, max: 500, currency: 'USD' as const }, maxHours: 6, languages: ['en'], stopWords: ['wordpress'], freeText: '', filters: defaultProfileFilters(), updatedAt: nowIso }
const settings = () => {
  const s = defaultSettings(nowIso)
  s.active = true
  s.telegram = { tokenSet: true, chatId: '-100', webhookSecret: 's' }
  s.platforms.freelancer = { enabled: true, query: 'react', tokenSet: true }
  return s
}
const job = (id: string, patch: Partial<Job> = {}): Job => ({
  platform: 'freelancer', externalId: id, url: `https://f.test/${id}`, title: `Job ${id}`, description: 'Small React fix',
  budget: { min: 100, max: 200, currency: 'USD', type: 'fixed' }, skills: ['React'], postedAt: '2026-09-20T11:00:00.000Z', language: 'en', ...patch,
})

function makeDeps(opts: { settings?: ReturnType<typeof settings> | null; jobs?: Job[]; known?: string[]; pending?: Match[]; score?: number; scoreFails?: boolean; sendFails?: boolean; fetchError?: Error } = {}) {
  const calls: string[] = []
  const store = {
    getProfile: vi.fn().mockResolvedValue(profile),
    getSettings: vi.fn().mockResolvedValue(opts.settings === undefined ? settings() : opts.settings),
    getPrompts: vi.fn().mockResolvedValue(null),
    listMatches: vi.fn().mockImplementation(async () => ({ items: opts.pending ?? [] })),
    existingMatchKeys: vi.fn().mockResolvedValue(new Set(opts.known ?? [])),
    putMatch: vi.fn().mockImplementation(async (_u: string, m: Match) => { calls.push(`put:${m.job.externalId}:${m.status}`) }),
    updateMatchStatus: vi.fn().mockImplementation(async (_u: string, ref: { externalId: string }, p: { status: string }) => { calls.push(`update:${ref.externalId}:${p.status}`) }),
    putRun: vi.fn().mockResolvedValue(undefined),
    touchLastPolled: vi.fn().mockResolvedValue(undefined),
  }
  const secrets = { getUserSecret: vi.fn().mockImplementation(async (_u: string, name: string) => (name === 'telegram/bot-token' ? 'bot' : 'fl-token')) }
  const fetchRecent = vi.fn().mockImplementation(async () => { calls.push('fetch'); if (opts.fetchError) throw opts.fetchError; return opts.jobs ?? [] })
  const sources = { freelancer: { platform: 'freelancer', fetchRecent, verifyToken: vi.fn() }, upwork: { platform: 'upwork', fetchRecent: vi.fn().mockResolvedValue([]), verifyToken: vi.fn() } }
  const parse = vi.fn().mockImplementation(async () => {
    if (opts.scoreFails) throw new Error('bedrock throttled')
    return { parsed_output: { score: opts.score ?? 85, reasoning: 'fits', estimatedHours: 2, risks: [] }, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, stop_reason: 'end_turn' }
  })
  const sendMessage = vi.fn().mockImplementation(async () => { calls.push('send'); if (opts.sendFails) throw new Error('tg down'); return { messageId: 99 } })
  const deps = {
    store, secrets, sources, createLlm: () => ({ messages: { create: vi.fn(), parse } }), createTelegram: () => ({ sendMessage }),
    appUrl: 'https://app', now: () => new Date(nowIso), log: createLogger({}, () => {}),
  } as unknown as PipelineDeps
  return { deps, store, calls, sendMessage, parse, fetchRecent }
}

describe('runForUser', () => {
  it('records telegram_not_configured and fetches nothing when chat/token missing', async () => {
    const s = settings(); s.telegram = { tokenSet: false }
    const { deps, store, fetchRecent } = makeDeps({ settings: s })
    const run = await runForUser(deps, 'u1', 'schedule')
    expect(run.errors).toEqual(['telegram_not_configured'])
    expect(fetchRecent).not.toHaveBeenCalled()
    expect(store.putRun).toHaveBeenCalledWith('u1', expect.objectContaining({ finishedAt: nowIso, trigger: 'schedule' }))
    expect(store.touchLastPolled).toHaveBeenCalledWith('u1', nowIso)
  })

  it('dedups, filters, scores, notifies and accounts usage', async () => {
    const jobs = [job('known'), job('wp', { title: 'WordPress theme' }), job('good')]
    const { deps, calls, sendMessage, parse } = makeDeps({ jobs, known: ['freelancer#known'] })
    const run = await runForUser(deps, 'u1', 'manual')
    expect(parse).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['fetch', 'put:wp:filtered', 'put:good:pending', 'send', 'update:good:notified'])
    expect(sendMessage.mock.calls[0]![1]).toContain('Job good')
    expect(run.perPlatform.freelancer).toEqual({ fetched: 3, new: 2, filtered: 1, scored: 1, notified: 1 })
    expect(run.usage).toEqual({ inputTokens: 100, outputTokens: 20 })
    expect(run.errors).toEqual([])
  })

  it('stores below-threshold jobs as scored without notifying', async () => {
    const { deps, calls, sendMessage } = makeDeps({ jobs: [job('meh')], score: 40 })
    await runForUser(deps, 'u1', 'schedule')
    expect(calls).toEqual(['fetch', 'put:meh:scored'])
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('retries pending matches before fetching', async () => {
    const pending: Match = { job: job('old'), status: 'pending', score: { score: 90, reasoning: 'r', estimatedHours: 1, risks: [] }, verdict: 'strong', createdAt: nowIso, ttl: 1 }
    const { deps, calls } = makeDeps({ pending: [pending], jobs: [] })
    const run = await runForUser(deps, 'u1', 'schedule')
    expect(calls).toEqual(['send', 'update:old:notified', 'fetch'])
    expect(run.perPlatform.freelancer!.notified).toBe(1)
  })

  it('keeps the match pending when Telegram fails', async () => {
    const { deps, calls } = makeDeps({ jobs: [job('x')], sendFails: true })
    const run = await runForUser(deps, 'u1', 'schedule')
    expect(calls).toEqual(['fetch', 'put:x:pending', 'send'])
    expect(run.errors[0]).toMatch(/^notify:/)
    expect(run.perPlatform.freelancer!.notified).toBe(0)
  })

  it('skips a job whose scoring fails and continues', async () => {
    const { deps, calls } = makeDeps({ jobs: [job('a')], scoreFails: true })
    const run = await runForUser(deps, 'u1', 'schedule')
    expect(calls).toEqual(['fetch'])
    expect(run.errors[0]).toMatch(/^score:freelancer:a:/)
    expect(run.perPlatform.freelancer!.scored).toBe(0)
  })

  it('records adapter errors per platform and still finishes the run', async () => {
    const { deps, store } = makeDeps({ fetchError: new SourceError('rl', 'rate_limited', 30) })
    const run = await runForUser(deps, 'u1', 'schedule')
    expect(run.perPlatform.freelancer!.error).toBe('rate_limited')
    expect(store.putRun).toHaveBeenCalledTimes(1)
  })

  it('caps LLM calls per run and leaves the rest for the next run', async () => {
    const jobs = Array.from({ length: MAX_SCORED_PER_RUN + 5 }, (_, i) => job(`j${i}`))
    const { deps, parse, store } = makeDeps({ jobs, score: 10 })
    const run = await runForUser(deps, 'u1', 'schedule')
    expect(parse).toHaveBeenCalledTimes(MAX_SCORED_PER_RUN)
    expect(store.putMatch).toHaveBeenCalledTimes(MAX_SCORED_PER_RUN)
    expect(run.perPlatform.freelancer!.scored).toBe(MAX_SCORED_PER_RUN)
    expect(run.errors).toEqual(['score_cap:freelancer:5_skipped'])
  })
})
