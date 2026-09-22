import { describe, it, expect, vi } from 'vitest'
import { deleteAccount, type AccountDeletionDeps } from './accountDeletion'

function makeDeps(opts: { token?: string | null; webhookFails?: boolean } = {}) {
  const calls: string[] = []
  const track = <T,>(name: string, impl?: () => Promise<T>) => vi.fn(async () => { calls.push(name); return impl ? impl() : (undefined as T) })
  const deps: AccountDeletionDeps = {
    store: { deleteUser: track('store.deleteUser') } as never,
    secrets: {
      getUserSecret: vi.fn().mockResolvedValue(opts.token === undefined ? 'bot-token' : opts.token),
      deleteUserSecret: vi.fn(async (_u: string, name: string) => { calls.push(`secrets.delete:${name}`) }),
    } as never,
    createTelegram: vi.fn(() => ({ deleteWebhook: track('telegram.deleteWebhook', opts.webhookFails ? () => Promise.reject(new Error('revoked')) : undefined) })) as never,
    deleteIdentity: track('deleteIdentity'),
  }
  return { deps, calls }
}

describe('deleteAccount', () => {
  it('unhooks Telegram, drops secrets and data, and deletes the identity last', async () => {
    const { deps, calls } = makeDeps()
    await deleteAccount(deps, 'u1')
    expect(deps.createTelegram).toHaveBeenCalledWith('bot-token')
    expect(calls).toEqual(['telegram.deleteWebhook', 'secrets.delete:telegram/bot-token', 'secrets.delete:freelancer/token', 'store.deleteUser', 'deleteIdentity'])
    expect(deps.deleteIdentity).toHaveBeenCalledWith('u1')
    expect(deps.store.deleteUser).toHaveBeenCalledWith('u1')
  })
  it('skips Telegram when no bot token is stored', async () => {
    const { deps, calls } = makeDeps({ token: null })
    await deleteAccount(deps, 'u1')
    expect(deps.createTelegram).not.toHaveBeenCalled()
    expect(calls).toEqual(['secrets.delete:telegram/bot-token', 'secrets.delete:freelancer/token', 'store.deleteUser', 'deleteIdentity'])
  })
  it('ignores a failing deleteWebhook (the token may already be revoked) and still finishes', async () => {
    const { deps, calls } = makeDeps({ webhookFails: true })
    await deleteAccount(deps, 'u1')
    expect(calls.at(-1)).toBe('deleteIdentity')
  })
  it('stops before the identity when data deletion fails, so the user can retry', async () => {
    const { deps } = makeDeps()
    ;(deps.store.deleteUser as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ddb down'))
    await expect(deleteAccount(deps, 'u1')).rejects.toThrow('ddb down')
    expect(deps.deleteIdentity).not.toHaveBeenCalled()
  })
})
