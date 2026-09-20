import { describe, it, expect } from 'vitest'
import { userPk, matchSk, chatSk, runSk, matchGsi2pk, ttlAfterDays, matchKey } from './keys'

describe('keys', () => {
  it('builds the documented key shapes', () => {
    expect(userPk('abc')).toBe('USER#abc')
    expect(matchKey({ platform: 'freelancer', externalId: '1' })).toBe('freelancer#1')
    expect(matchSk({ platform: 'freelancer', externalId: '1' })).toBe('MATCH#freelancer#1')
    expect(chatSk({ platform: 'upwork', externalId: '~x' })).toBe('CHAT#upwork#~x')
    expect(runSk('2026-09-20T10:00:00.000Z')).toBe('RUN#2026-09-20T10:00:00.000Z')
    expect(matchGsi2pk('abc', 'pending')).toBe('USER#abc#pending')
  })
  it('ttlAfterDays is epoch seconds', () => {
    expect(ttlAfterDays('2026-09-20T00:00:00.000Z', 1)).toBe(Math.floor(Date.parse('2026-09-21T00:00:00.000Z') / 1000))
  })
})
