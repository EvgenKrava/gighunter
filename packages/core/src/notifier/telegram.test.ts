import { describe, it, expect, vi } from 'vitest'
import { TelegramClient, TelegramError } from './telegram'

const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'content-type': 'application/json' } })
const fail = (status: number, description: string) =>
  new Response(JSON.stringify({ ok: false, error_code: status, description }), { status, headers: { 'content-type': 'application/json' } })

describe('TelegramClient', () => {
  it('posts JSON to the bot method URL and unwraps result', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok({ id: 1, username: 'gh_bot', is_bot: true }))
    const tg = new TelegramClient('123:ABC', fetchFn)
    expect(await tg.getMe()).toEqual({ id: 1, username: 'gh_bot' })
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('https://api.telegram.org/bot123:ABC/getMe')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' })
  })
  it('sendMessage returns message id and passes parse_mode + reply_markup', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok({ message_id: 42 }))
    const tg = new TelegramClient('t', fetchFn)
    const kb = { inline_keyboard: [[{ text: 'x', callback_data: 'noop' }]] }
    expect(await tg.sendMessage('-100', '<b>hi</b>', kb)).toEqual({ messageId: 42 })
    const body = JSON.parse(fetchFn.mock.calls[0]![1].body)
    expect(body).toEqual({ chat_id: '-100', text: '<b>hi</b>', parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: kb })
  })
  it('setWebhook sends url, secret_token and allowed_updates', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok(true))
    await new TelegramClient('t', fetchFn).setWebhook('https://api/x', 'sec', ['message'])
    expect(JSON.parse(fetchFn.mock.calls[0]![1].body)).toEqual({ url: 'https://api/x', secret_token: 'sec', allowed_updates: ['message'] })
  })
  it('maps ok:false to TelegramError without leaking the token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(fail(401, 'Unauthorized'))
    const err = await new TelegramClient('SECRET_TOKEN', fetchFn).getMe().catch((e) => e)
    expect(err).toBeInstanceOf(TelegramError)
    expect(err.code).toBe(401)
    expect(err.message).toContain('Unauthorized')
    expect(err.message).not.toContain('SECRET_TOKEN')
  })
  it('maps network failures to TelegramError', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    await expect(new TelegramClient('t', fetchFn).deleteWebhook()).rejects.toBeInstanceOf(TelegramError)
  })
})
