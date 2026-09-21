import { describe, it, expect, vi } from 'vitest'
import { apiFetch, ApiError } from './client'

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('apiFetch', () => {
  it('sends bearer token and JSON body, parses JSON', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res(200, { ok: 1 }))
    const out = await apiFetch<{ ok: number }>('https://api.test', 'tok', '/profile', { method: 'PUT', json: { a: 1 } }, fetchFn)
    expect(out).toEqual({ ok: 1 })
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('https://api.test/profile')
    expect(init.method).toBe('PUT')
    expect(init.headers).toMatchObject({ authorization: 'Bearer tok', 'content-type': 'application/json' })
    expect(init.body).toBe('{"a":1}')
  })
  it('returns undefined on 204', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res(204))
    expect(await apiFetch('https://api.test', 'tok', '/x', { method: 'POST' }, fetchFn)).toBeUndefined()
  })
  it('maps errors to ApiError with status, code and issues', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res(400, { error: 'validation_failed', code: 'bad', issues: [{ path: ['a'] }] }))
    const err = await apiFetch('https://api.test', 'tok', '/x', {}, fetchFn).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 400, message: 'validation_failed', code: 'bad', issues: [{ path: ['a'] }] })
  })
  it('handles non-JSON error bodies', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('gateway down', { status: 502 }))
    const err = await apiFetch('https://api.test', 'tok', '/x', {}, fetchFn).catch((e) => e)
    expect(err).toMatchObject({ status: 502, message: 'HTTP 502' })
  })
})
