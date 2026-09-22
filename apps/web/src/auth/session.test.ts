import { describe, it, expect, vi } from 'vitest'
import { renewSession } from './session'

describe('renewSession', () => {
  it('resolves to the renewed ID token', async () => {
    const signinSilent = vi.fn().mockResolvedValue({ id_token: 'fresh' })
    await expect(renewSession({ signinSilent })).resolves.toBe('fresh')
  })
  it('resolves to null when the renew fails (react-oidc-context returns null instead of throwing)', async () => {
    const signinSilent = vi.fn().mockResolvedValue(null)
    await expect(renewSession({ signinSilent })).resolves.toBeNull()
  })
  it('shares one in-flight renew between concurrent callers, then allows a new one', async () => {
    let release!: (u: { id_token: string }) => void
    const signinSilent = vi.fn().mockImplementationOnce(() => new Promise((r) => { release = r })).mockResolvedValueOnce({ id_token: 'second' })
    const a = renewSession({ signinSilent })
    const b = renewSession({ signinSilent })
    expect(signinSilent).toHaveBeenCalledTimes(1)
    release({ id_token: 'first' })
    await expect(Promise.all([a, b])).resolves.toEqual(['first', 'first'])
    await expect(renewSession({ signinSilent })).resolves.toBe('second')
    expect(signinSilent).toHaveBeenCalledTimes(2)
  })
})
