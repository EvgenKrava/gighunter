import { describe, it, expect, vi } from 'vitest'
import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { createWebhookHandler } from './handler'
import { defaultSettings } from '@gighunter/core/schema'
import { SAMPLE_MATCH } from '@gighunter/core/prompts'
import { createLogger } from '@gighunter/core/logger'

const nowIso = '2026-09-20T10:00:00.000Z'
const base = () => ({ ...defaultSettings(nowIso), telegram: { tokenSet: true, webhookSecret: 'sec', chatId: '-100', chatTitle: 'My gigs' } })

function makeDeps(settings: ReturnType<typeof defaultSettings> | null = base()) {
  const store = {
    getSettings: vi.fn().mockResolvedValue(settings),
    putSettings: vi.fn(),
    setMatchFeedback: vi.fn().mockResolvedValue({ ...SAMPLE_MATCH, feedback: 'up' }),
  }
  const tg = { answerCallbackQuery: vi.fn(), editMessageReplyMarkup: vi.fn(), sendMessage: vi.fn() }
  const deps = { store, secrets: { getUserSecret: vi.fn().mockResolvedValue('bot-token') }, createTelegram: vi.fn().mockReturnValue(tg), now: () => new Date(nowIso), log: createLogger({}, () => {}) }
  return { deps: deps as never, store, tg }
}
const event = (body: unknown, secret = 'sec', userId = 'u1') =>
  ({ pathParameters: { userId }, headers: { 'x-telegram-bot-api-secret-token': secret }, body: typeof body === 'string' ? body : JSON.stringify(body) }) as unknown as APIGatewayProxyEventV2

const status = (r: unknown) => (r as { statusCode: number }).statusCode

describe('tg-webhook', () => {
  it('403 on secret mismatch or missing settings', async () => {
    const { deps } = makeDeps()
    expect(status(await createWebhookHandler(deps)(event({}, 'wrong')))).toBe(403)
    const { deps: none } = makeDeps(null as never)
    expect(status(await createWebhookHandler(none)(event({})))).toBe(403)
  })
  it('400 on bad JSON, 200 on unknown update', async () => {
    const { deps } = makeDeps()
    expect(status(await createWebhookHandler(deps)(event('{nope')))).toBe(400)
    expect(status(await createWebhookHandler(deps)(event({ update_id: 1 })))).toBe(200)
  })
  it('callback_query stores feedback, answers and swaps the keyboard', async () => {
    const { deps, store, tg } = makeDeps()
    const res = await createWebhookHandler(deps)(event({ callback_query: { id: 'cq1', data: 'fb:freelancer:sample-1:up', message: { message_id: 7, chat: { id: -100 } } } }))
    expect(status(res)).toBe(200)
    expect(store.setMatchFeedback).toHaveBeenCalledWith('u1', { platform: 'freelancer', externalId: 'sample-1' }, 'up', nowIso)
    expect(tg.answerCallbackQuery).toHaveBeenCalledWith('cq1', expect.any(String))
    expect(tg.editMessageReplyMarkup).toHaveBeenCalledWith('-100', 7, { inline_keyboard: [[{ text: '✅ Marked useful', callback_data: 'noop' }]] })
  })
  it('callback with unknown data is answered and ignored', async () => {
    const { deps, store, tg } = makeDeps()
    await createWebhookHandler(deps)(event({ callback_query: { id: 'cq2', data: 'noop' } }))
    expect(store.setMatchFeedback).not.toHaveBeenCalled()
    expect(tg.answerCallbackQuery).toHaveBeenCalledWith('cq2')
  })
  it('/start in a private chat sets chatId and replies', async () => {
    const { deps, store, tg } = makeDeps()
    await createWebhookHandler(deps)(event({ message: { text: '/start', chat: { id: 555, type: 'private' }, from: { username: 'yev' } } }))
    expect(store.putSettings).toHaveBeenCalledWith('u1', expect.objectContaining({ telegram: expect.objectContaining({ chatId: '555', chatTitle: 'DM with @yev' }) }))
    expect(tg.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('Connected'))
  })
  it('bot promoted to admin in a channel sets chatId; removal clears it', async () => {
    const { deps, store } = makeDeps()
    await createWebhookHandler(deps)(event({ my_chat_member: { chat: { id: -200, type: 'channel', title: 'Gigs' }, new_chat_member: { status: 'administrator' } } }))
    expect(store.putSettings.mock.calls[0]![1].telegram).toMatchObject({ chatId: '-200', chatTitle: 'Gigs' })
    const { deps: d2, store: s2 } = makeDeps()
    await createWebhookHandler(d2)(event({ my_chat_member: { chat: { id: -100, type: 'channel', title: 'My gigs' }, new_chat_member: { status: 'left' } } }))
    expect(s2.putSettings.mock.calls[0]![1].telegram.chatId).toBeUndefined()
  })
  it('channel_post only sets chatId when none is configured', async () => {
    const { deps, store } = makeDeps({ ...base(), telegram: { tokenSet: true, webhookSecret: 'sec' } })
    await createWebhookHandler(deps)(event({ channel_post: { chat: { id: -300, type: 'channel', title: 'New' } } }))
    expect(store.putSettings.mock.calls[0]![1].telegram).toMatchObject({ chatId: '-300', chatTitle: 'New' })
    const { deps: d2, store: s2 } = makeDeps()
    await createWebhookHandler(d2)(event({ channel_post: { chat: { id: -300, type: 'channel', title: 'New' } } }))
    expect(s2.putSettings).not.toHaveBeenCalled()
  })
})
