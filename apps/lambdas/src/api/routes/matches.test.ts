import { describe, it, expect, vi } from 'vitest'
import { createApp } from '../app'
import { makeApiDeps, authed, json } from '../test-utils'
import { SAMPLE_MATCH } from '@gighunter/core/prompts'

const nowIso = '2026-09-20T10:00:00.000Z'
const profile = { displayName: 'Yev', skills: [], budget: { min: 1, max: 9, currency: 'USD' }, maxHours: 4, languages: ['en'], stopWords: [], freeText: '', updatedAt: nowIso }

describe('/matches', () => {
  it('GET defaults to notified, validates status, forwards cursor/limit', async () => {
    const deps = makeApiDeps()
    await createApp(deps).request('/matches', {}, authed('s'))
    expect(deps.store.listMatches).toHaveBeenCalledWith('s', 'notified', { limit: 50, cursor: undefined })
    await createApp(deps).request('/matches?status=filtered&limit=5&cursor=abc', {}, authed('s'))
    expect(deps.store.listMatches).toHaveBeenLastCalledWith('s', 'filtered', { limit: 5, cursor: 'abc' })
    expect((await createApp(deps).request('/matches?status=weird', {}, authed())).status).toBe(400)
  })
  it('GET /matches/:platform/:id returns match + chat or 404', async () => {
    const deps = makeApiDeps({ store: { getMatch: vi.fn().mockResolvedValue(SAMPLE_MATCH), getChat: vi.fn().mockResolvedValue(null) } })
    const res = await createApp(deps).request('/matches/freelancer/sample-1', {}, authed())
    expect(await res.json()).toEqual({ match: SAMPLE_MATCH, chat: null })
    expect((await createApp(makeApiDeps()).request('/matches/freelancer/nope', {}, authed())).status).toBe(404)
    expect((await createApp(makeApiDeps()).request('/matches/fiverr/1', {}, authed())).status).toBe(400)
  })
  it('POST feedback stores and returns the match', async () => {
    const deps = makeApiDeps({ store: { setMatchFeedback: vi.fn().mockResolvedValue({ ...SAMPLE_MATCH, feedback: 'down' }) } })
    const res = await createApp(deps).request('/matches/freelancer/sample-1/feedback', json({ feedback: 'down' }), authed('s'))
    expect(res.status).toBe(200)
    expect(deps.store.setMatchFeedback).toHaveBeenCalledWith('s', { platform: 'freelancer', externalId: 'sample-1' }, 'down', nowIso)
    expect((await createApp(makeApiDeps()).request('/matches/freelancer/x/feedback', json({ feedback: 'up' }), authed())).status).toBe(404)
  })
  it('POST chat runs a turn; 404 when match missing; DELETE chat resets', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Draft!' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
    const deps = makeApiDeps({ store: { getMatch: vi.fn().mockResolvedValue(SAMPLE_MATCH), getProfile: vi.fn().mockResolvedValue(profile) }, createLlm: vi.fn().mockReturnValue({ messages: { create, parse: vi.fn() } }) })
    const res = await createApp(deps).request('/matches/freelancer/sample-1/chat', json({ message: 'Draft a proposal' }), authed('s'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ reply: 'Draft!', truncated: false, usage: { inputTokens: 10, outputTokens: 5 } })
    expect(deps.store.putChat).toHaveBeenCalled()
    expect((await createApp(deps).request('/matches/freelancer/sample-1/chat', json({ message: '' }), authed())).status).toBe(400)
    expect((await createApp(makeApiDeps()).request('/matches/freelancer/zzz/chat', json({ message: 'x' }), authed())).status).toBe(404)
    const del = await createApp(deps).request('/matches/freelancer/sample-1/chat', { method: 'DELETE' }, authed('s'))
    expect(del.status).toBe(204)
    expect(deps.store.deleteChat).toHaveBeenCalledWith('s', { platform: 'freelancer', externalId: 'sample-1' })
  })
})
