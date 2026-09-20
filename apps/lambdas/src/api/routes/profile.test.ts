import { describe, it, expect, vi } from 'vitest'
import { createApp } from '../app'
import { makeApiDeps, authed, json } from '../test-utils'

const input = { displayName: 'Yev', skills: [{ name: 'TS', level: 'expert' }], budget: { min: 50, max: 500, currency: 'USD' }, maxHours: 6, languages: ['en'], stopWords: [], freeText: '' }

describe('/profile', () => {
  it('GET 404 when missing, 200 when present', async () => {
    const deps = makeApiDeps()
    expect((await createApp(deps).request('/profile', {}, authed())).status).toBe(404)
    ;(deps.store.getProfile as ReturnType<typeof vi.fn>).mockResolvedValue({ ...input, updatedAt: 'x' })
    expect((await createApp(deps).request('/profile', {}, authed())).status).toBe(200)
  })
  it('PUT validates, stamps updatedAt and stores under the JWT sub', async () => {
    const deps = makeApiDeps()
    const res = await createApp(deps).request('/profile', json(input, 'PUT'), authed('sub-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ...input, updatedAt: '2026-09-20T10:00:00.000Z' })
    expect(deps.store.putProfile).toHaveBeenCalledWith('sub-1', body)
  })
  it('PUT 400 with issues on invalid body', async () => {
    const res = await createApp(makeApiDeps()).request('/profile', json({ ...input, maxHours: -1 }, 'PUT'), authed())
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'validation_failed', issues: expect.any(Array) })
  })
})
