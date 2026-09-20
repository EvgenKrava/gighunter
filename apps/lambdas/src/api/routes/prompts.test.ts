import { describe, it, expect, vi } from 'vitest'
import { createApp } from '../app'
import { makeApiDeps, authed, json, body as parse } from '../test-utils'
import { DEFAULT_SCORING_PROMPT, DEFAULT_QUICK_ACTIONS } from '@gighunter/core/prompts'

const nowIso = '2026-09-20T10:00:00.000Z'
const profile = { displayName: 'Yev', skills: [], budget: { min: 1, max: 9, currency: 'USD' }, maxHours: 4, languages: ['en'], stopWords: [], freeText: 'about me', updatedAt: nowIso }

describe('/prompts', () => {
  it('GET returns defaults, overrides and placeholder list', async () => {
    const deps = makeApiDeps({ store: { getPrompts: vi.fn().mockResolvedValue({ scoring: 'mine', updatedAt: nowIso }) } })
    const body = await parse(await createApp(deps).request('/prompts', {}, authed()))
    expect(body.defaults.scoring).toBe(DEFAULT_SCORING_PROMPT)
    expect(body.defaults.quickActions).toEqual(DEFAULT_QUICK_ACTIONS)
    expect(body.overrides).toEqual({ scoring: 'mine', updatedAt: nowIso })
    expect(body.placeholders).toEqual(['{{app_context}}', '{{profile}}', '{{job}}', '{{score}}'])
  })
  it('PUT sets fields, null resets, unknown keys rejected', async () => {
    const deps = makeApiDeps({ store: { getPrompts: vi.fn().mockResolvedValue({ scoring: 'old', chat: 'oldchat', updatedAt: 'x' }) } })
    const res = await createApp(deps).request('/prompts', json({ scoring: null, quickActions: [{ label: 'A', text: 'do a' }] }, 'PUT'), authed('s'))
    expect(res.status).toBe(200)
    const saved = (deps.store.putPrompts as ReturnType<typeof vi.fn>).mock.calls[0]![1]
    expect(saved).toEqual({ chat: 'oldchat', quickActions: [{ label: 'A', text: 'do a' }], updatedAt: nowIso })
    expect((await createApp(deps).request('/prompts', json({ nope: 1 }, 'PUT'), authed())).status).toBe(400)
  })
  it('POST /preview renders with the real profile and the sample job', async () => {
    const deps = makeApiDeps({ store: { getProfile: vi.fn().mockResolvedValue(profile) } })
    const res = await createApp(deps).request('/prompts/preview', json({ kind: 'chat', template: 'X {{job}} Y' }), authed())
    const body = await parse(res)
    expect(body.rendered).toContain('Fix Stripe webhook retries')
    expect(body.rendered).toContain('about me')
    const noProfile = makeApiDeps()
    expect((await createApp(noProfile).request('/prompts/preview', json({ kind: 'scoring', template: 't' }), authed())).status).toBe(400)
  })
})
