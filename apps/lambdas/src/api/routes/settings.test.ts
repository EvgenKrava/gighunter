import { describe, it, expect, vi } from 'vitest'
import { createApp } from '../app'
import { makeApiDeps, authed, json, body as parse } from '../test-utils'
import { defaultSettings } from '@gighunter/core/schema'
import { TelegramError } from '@gighunter/core/notifier'

const nowIso = '2026-09-20T10:00:00.000Z'

describe('/settings', () => {
  it('GET returns defaults when nothing stored and never exposes webhookSecret', async () => {
    const deps = makeApiDeps({ store: { getSettings: vi.fn().mockResolvedValue({ ...defaultSettings(nowIso), telegram: { tokenSet: true, webhookSecret: 'SECRET', chatId: '1' } }) } })
    const res = await createApp(deps).request('/settings', {}, authed())
    const body = await parse(res)
    expect(body.telegram).toEqual({ tokenSet: true, chatId: '1' })
    expect(JSON.stringify(body)).not.toContain('SECRET')
    const empty = makeApiDeps()
    expect((await parse(await createApp(empty).request('/settings', {}, authed()))).notifyThreshold).toBe(70)
  })
  it('PATCH merges nested fields and rejects unknown keys', async () => {
    const deps = makeApiDeps({ store: { getSettings: vi.fn().mockResolvedValue({ ...defaultSettings(nowIso), platforms: { freelancer: { enabled: false, query: 'old', tokenSet: true, tokenHint: '1234', connectedAs: 'yev' }, upwork: { enabled: false } } }) } })
    const res = await createApp(deps).request('/settings', json({ notifyThreshold: 80, platforms: { freelancer: { enabled: true } }, telegram: { chatId: '-5' } }, 'PATCH'), authed('s'))
    expect(res.status).toBe(200)
    const saved = (deps.store.putSettings as ReturnType<typeof vi.fn>).mock.calls[0]![1]
    expect(saved.notifyThreshold).toBe(80)
    expect(saved.platforms.freelancer).toEqual({ enabled: true, query: 'old', tokenSet: true, tokenHint: '1234', connectedAs: 'yev' })
    expect(saved.telegram.chatId).toBe('-5')
    expect(saved.updatedAt).toBe(nowIso)
    expect((await createApp(deps).request('/settings', json({ telegram: { webhookSecret: 'x' } }, 'PATCH'), authed())).status).toBe(400)
  })
})

describe('/settings/telegram/token', () => {
  it('PUT connects the bot and returns masked settings', async () => {
    const tg = { getMe: vi.fn().mockResolvedValue({ id: 1, username: 'gh_bot' }), setWebhook: vi.fn() }
    const deps = makeApiDeps({ createTelegram: vi.fn().mockReturnValue(tg) })
    const res = await createApp(deps).request('/settings/telegram/token', json({ token: '123456:abcdefgh' }, 'PUT'), authed('s'))
    expect(res.status).toBe(200)
    const body = await parse(res)
    expect(body.telegram).toMatchObject({ tokenSet: true, botUsername: 'gh_bot', tokenHint: 'efgh' })
    expect(body.telegram.webhookSecret).toBeUndefined()
    expect(tg.setWebhook).toHaveBeenCalledWith('https://api.test/telegram/webhook/s', expect.any(String), expect.any(Array))
    expect(deps.secrets.putUserSecret).toHaveBeenCalledWith('s', 'telegram/bot-token', '123456:abcdefgh')
  })
  it('PUT maps Telegram rejection to 400', async () => {
    const tg = { getMe: vi.fn().mockRejectedValue(new TelegramError('telegram getMe failed: Unauthorized', 401)) }
    const deps = makeApiDeps({ createTelegram: vi.fn().mockReturnValue(tg) })
    const res = await createApp(deps).request('/settings/telegram/token', json({ token: '123456:abcdefgh' }, 'PUT'), authed())
    expect(res.status).toBe(400)
    expect((await parse(res)).code).toBe('telegram_error')
  })
  it('DELETE disconnects; POST /test sends or 400s', async () => {
    const tg = { deleteWebhook: vi.fn(), sendMessage: vi.fn().mockResolvedValue({ messageId: 1 }) }
    const deps = makeApiDeps({ createTelegram: vi.fn().mockReturnValue(tg), secrets: { getUserSecret: vi.fn().mockResolvedValue('tok'), deleteUserSecret: vi.fn(), putUserSecret: vi.fn() } })
    expect((await createApp(deps).request('/settings/telegram/token', { method: 'DELETE' }, authed())).status).toBe(200)
    expect(deps.secrets.deleteUserSecret).toHaveBeenCalledWith('u1', 'telegram/bot-token')
    expect((await createApp(deps).request('/settings/telegram/test', { method: 'POST' }, authed())).status).toBe(400)
    ;(deps.store.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ ...defaultSettings(nowIso), telegram: { tokenSet: true, chatId: '-1' } })
    expect((await createApp(deps).request('/settings/telegram/test', { method: 'POST' }, authed())).status).toBe(204)
  })
})

describe('/settings/freelancer/token', () => {
  it('PUT verifies with the adapter and stores; DELETE clears', async () => {
    const deps = makeApiDeps()
    ;(deps.sources.freelancer.verifyToken as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, username: 'yev' })
    const res = await createApp(deps).request('/settings/freelancer/token', json({ token: 'fl-token-1234' }, 'PUT'), authed('s'))
    expect(res.status).toBe(200)
    expect((await parse(res)).platforms.freelancer).toMatchObject({ tokenSet: true, connectedAs: 'yev', tokenHint: '1234' })
    ;(deps.sources.freelancer.verifyToken as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'http_401' })
    expect((await createApp(deps).request('/settings/freelancer/token', json({ token: 'bad-token-1' }, 'PUT'), authed())).status).toBe(400)
    expect((await createApp(deps).request('/settings/freelancer/token', { method: 'DELETE' }, authed('s'))).status).toBe(200)
    expect(deps.secrets.deleteUserSecret).toHaveBeenCalledWith('s', 'freelancer/token')
  })
})
