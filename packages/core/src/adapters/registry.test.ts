import { describe, it, expect } from 'vitest'
import { createSources, enabledPlatforms, UpworkSource } from './index'
import { defaultSettings } from '../schema/index'

describe('registry', () => {
  it('createSources returns one adapter per platform', () => {
    const s = createSources()
    expect(s.freelancer.platform).toBe('freelancer')
    expect(s.upwork).toBeInstanceOf(UpworkSource)
  })
  it('enabledPlatforms requires enabled + tokenSet', () => {
    const base = defaultSettings('2026-09-20T10:00:00.000Z')
    expect(enabledPlatforms(base)).toEqual([])
    const on = { ...base, platforms: { ...base.platforms, freelancer: { ...base.platforms.freelancer, enabled: true, tokenSet: true } } }
    expect(enabledPlatforms(on)).toEqual(['freelancer'])
    const noToken = { ...base, platforms: { ...base.platforms, freelancer: { ...base.platforms.freelancer, enabled: true } } }
    expect(enabledPlatforms(noToken)).toEqual([])
  })
  it('upwork stub returns nothing and refuses tokens', async () => {
    const u = new UpworkSource()
    expect(await u.fetchRecent({ query: '', since: new Date(), token: '' })).toEqual([])
    expect(await u.verifyToken('x')).toEqual({ ok: false, error: 'not_implemented' })
  })
})
