import { describe, it, expect } from 'vitest'
import { env, buildCoreDeps } from './deps'

describe('deps', () => {
  it('env throws on missing variables', () => {
    delete process.env.NOPE_X
    expect(() => env('NOPE_X')).toThrow(/NOPE_X/)
  })
  it('buildCoreDeps wires store/secrets/sources/factories from env', () => {
    process.env.TABLE_NAME = 'tbl'
    process.env.AWS_REGION = 'us-east-1'
    const deps = buildCoreDeps('test')
    expect(deps.store).toBeDefined()
    expect(deps.secrets.userParamName('u', 'freelancer/token')).toBe('/gighunter/users/u/freelancer/token')
    expect(deps.sources.freelancer.platform).toBe('freelancer')
    expect(typeof deps.createLlm).toBe('function')
    expect(typeof deps.createTelegram).toBe('function')
    expect(deps.now()).toBeInstanceOf(Date)
  })
})
