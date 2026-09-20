import { describe, it, expect, vi } from 'vitest'
import { connectFreelancer, disconnectFreelancer } from './freelancerSetup'
import { defaultSettings } from '../schema/index'
import type { Store } from '../store/index'
import type { Secrets } from '../secrets/index'

const now = () => new Date('2026-09-20T10:00:00.000Z')
function makeDeps(verify: unknown) {
  const store = { getSettings: vi.fn().mockResolvedValue(defaultSettings(now().toISOString())), putSettings: vi.fn() } as unknown as Store
  const secrets = { putUserSecret: vi.fn(), deleteUserSecret: vi.fn() } as unknown as Secrets
  const sources = { freelancer: { platform: 'freelancer', fetchRecent: vi.fn(), verifyToken: vi.fn().mockResolvedValue(verify) }, upwork: { platform: 'upwork', fetchRecent: vi.fn(), verifyToken: vi.fn() } }
  return { deps: { store, secrets, sources: sources as never, now }, store, secrets }
}

describe('connectFreelancer', () => {
  it('stores token and marks connected on success', async () => {
    const { deps, secrets } = makeDeps({ ok: true, username: 'yev' })
    const s = await connectFreelancer(deps, 'u1', 'tok12345')
    expect(secrets.putUserSecret).toHaveBeenCalledWith('u1', 'freelancer/token', 'tok12345')
    expect(s.platforms.freelancer).toMatchObject({ tokenSet: true, tokenHint: '2345', connectedAs: 'yev' })
  })
  it('rejects invalid tokens with 400 and stores nothing', async () => {
    const { deps, secrets } = makeDeps({ ok: false, error: 'http_401' })
    await expect(connectFreelancer(deps, 'u1', 'bad')).rejects.toMatchObject({ status: 400, code: 'invalid_token' })
    expect(secrets.putUserSecret).not.toHaveBeenCalled()
  })
  it('disconnect clears token, connection and disables polling', async () => {
    const { deps, secrets } = makeDeps({ ok: true, username: 'yev' })
    const s = await disconnectFreelancer(deps, 'u1')
    expect(secrets.deleteUserSecret).toHaveBeenCalledWith('u1', 'freelancer/token')
    expect(s.platforms.freelancer).toEqual({ enabled: false, query: '', tokenSet: false })
  })
})
