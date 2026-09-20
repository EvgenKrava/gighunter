import { describe, it, expect, vi } from 'vitest'
import type { PreSignUpTriggerEvent } from 'aws-lambda'
import { createPreSignupHandler } from './handler'
import { createLogger } from '@gighunter/core/logger'

const event = (email?: string) =>
  ({ request: { userAttributes: email ? { email } : {} }, response: { autoConfirmUser: false, autoVerifyEmail: false, autoVerifyPhone: false } }) as unknown as PreSignUpTriggerEvent

describe('pre-signup', () => {
  const deps = { secrets: { getAllowedEmails: vi.fn().mockResolvedValue(['me@example.com']) }, log: createLogger({}, () => {}) }
  it('auto-confirms allowlisted emails (case-insensitive)', async () => {
    const out = await createPreSignupHandler(deps)(event('Me@Example.com'), {} as never, () => {})
    expect(out!.response.autoConfirmUser).toBe(true)
    expect(out!.response.autoVerifyEmail).toBe(true)
  })
  it('rejects unknown and missing emails', async () => {
    await expect(createPreSignupHandler(deps)(event('x@y.com'), {} as never, () => {})).rejects.toThrow(/invitation/)
    await expect(createPreSignupHandler(deps)(event(), {} as never, () => {})).rejects.toThrow(/invitation/)
  })
})
