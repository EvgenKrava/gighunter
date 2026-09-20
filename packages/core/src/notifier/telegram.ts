import type { InlineKeyboard } from './format'

export type FetchFn = typeof fetch

export class TelegramError extends Error {
  constructor(message: string, readonly code?: number, readonly description?: string) {
    super(message)
    this.name = 'TelegramError'
  }
}

interface ApiEnvelope<T> { ok: boolean; result?: T; description?: string; error_code?: number }

export class TelegramClient {
  constructor(
    private readonly token: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly baseUrl = 'https://api.telegram.org',
  ) {}

  private async call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    let res: Response
    try {
      res = await this.fetchFn(`${this.baseUrl}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (e) {
      throw new TelegramError(`telegram ${method}: network error: ${(e as Error).message}`)
    }
    let json: ApiEnvelope<T> | undefined
    try {
      json = (await res.json()) as ApiEnvelope<T>
    } catch {
      /* non-JSON body */
    }
    if (!res.ok || !json?.ok) {
      throw new TelegramError(`telegram ${method} failed: ${json?.description ?? `HTTP ${res.status}`}`, json?.error_code ?? res.status, json?.description)
    }
    return json.result as T
  }

  async getMe(): Promise<{ id: number; username: string }> {
    const me = await this.call<{ id: number; username: string }>('getMe')
    return { id: me.id, username: me.username }
  }

  async setWebhook(url: string, secretToken: string, allowedUpdates: string[]): Promise<void> {
    await this.call('setWebhook', { url, secret_token: secretToken, allowed_updates: allowedUpdates })
  }

  async deleteWebhook(): Promise<void> {
    await this.call('deleteWebhook')
  }

  async sendMessage(chatId: string, text: string, replyMarkup?: InlineKeyboard): Promise<{ messageId: number }> {
    const r = await this.call<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    })
    return { messageId: r.message_id }
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) })
  }

  async editMessageReplyMarkup(chatId: string, messageId: number, replyMarkup: InlineKeyboard): Promise<void> {
    await this.call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: replyMarkup })
  }
}
