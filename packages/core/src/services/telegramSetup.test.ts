import { describe, it, expect, vi } from 'vitest'
import { connectTelegramBot, disconnectTelegramBot, sendTelegramTest, webhookUrl } from './telegramSetup'
import { ServiceError } from './errors'
import { defaultSettings } from '../schema/index'
import type { Store } from '../store/index'
import type { Secrets } from '../secrets/index'
import type { TelegramClient } from '../notifier/index'

const now = () => new Date('2026-09-20T10:00:00.000Z')

function makeDeps(existing = defaultSettings(now().toISOString())) {
  const store = { getSettings: vi.fn().mockResolvedValue(existing), putSettings: vi.fn().mockResolvedValue(undefined) } as unknown as Store
  const secrets = { putUserSecret: vi.fn(), deleteUserSecret: vi.fn(), getUserSecret: vi.fn().mockResolvedValue('123:abc') } as unknown as Secrets
  const tg = { getMe: vi.fn().mockResolvedValue({ id: 1, username: 'gh_bot' }), setWebhook: vi.fn(), deleteWebhook: vi.fn(), sendMessage: vi.fn().mockResolvedValue({ messageId: 1 }) }
  const createTelegram = vi.fn().mockReturnValue(tg as unknown as TelegramClient)
  return { deps: { store, secrets, createTelegram, apiBaseUrl: 'https://api.example.com/', now }, store, secrets, tg, createTelegram }
}

describe('connectTelegramBot', () => {
  it('validates via getMe, registers webhook with a fresh secret, stores token and settings', async () => {
    const { deps, store, secrets, tg, createTelegram } = makeDeps({ ...defaultSettings(now().toISOString()), telegram: { tokenSet: false, chatId: '-100' } })
    const settings = await connectTelegramBot(deps, 'u1', '123:abcdEFGH')
    expect(createTelegram).toHaveBeenCalledWith('123:abcdEFGH')
    expect(tg.setWebhook).toHaveBeenCalledWith('https://api.example.com/telegram/webhook/u1', expect.stringMatching(/^[0-9a-f]{64}$/), ['message', 'callback_query', 'my_chat_member', 'channel_post'])
    expect(secrets.putUserSecret).toHaveBeenCalledWith('u1', 'telegram/bot-token', '123:abcdEFGH')
    expect(settings.telegram).toMatchObject({ tokenSet: true, tokenHint: 'EFGH', botUsername: 'gh_bot', chatId: '-100' })
    expect(settings.telegram.webhookSecret).toHaveLength(64)
    expect(store.putSettings).toHaveBeenCalledWith('u1', settings)
  })
  it('creates settings when none exist', async () => {
    const { deps, store } = makeDeps()
    ;(store.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const s = await connectTelegramBot(deps, 'u1', '1:a')
    expect(s.notifyThreshold).toBe(70)
  })
})

describe('disconnectTelegramBot', () => {
  it('deletes webhook and secret, clears telegram fields', async () => {
    const { deps, secrets, tg } = makeDeps({ ...defaultSettings(now().toISOString()), telegram: { tokenSet: true, chatId: '-1', botUsername: 'b', webhookSecret: 's' } })
    const s = await disconnectTelegramBot(deps, 'u1')
    expect(tg.deleteWebhook).toHaveBeenCalled()
    expect(secrets.deleteUserSecret).toHaveBeenCalledWith('u1', 'telegram/bot-token')
    expect(s.telegram).toEqual({ tokenSet: false })
  })
})

describe('sendTelegramTest', () => {
  it('throws 400 when not configured, sends otherwise', async () => {
    const unconfigured = makeDeps()
    await expect(sendTelegramTest(unconfigured.deps, 'u1')).rejects.toMatchObject({ status: 400, code: 'telegram_not_configured' })
    const ok = makeDeps({ ...defaultSettings(now().toISOString()), telegram: { tokenSet: true, chatId: '-100' } })
    await sendTelegramTest(ok.deps, 'u1')
    expect(ok.tg.sendMessage).toHaveBeenCalledWith('-100', expect.stringContaining('test'))
  })
  it('webhookUrl trims trailing slash', () => {
    expect(webhookUrl('https://a/', 'u')).toBe('https://a/telegram/webhook/u')
    expect(new ServiceError('x', 400, 'c').status).toBe(400)
  })
})
