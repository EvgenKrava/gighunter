import { timingSafeEqual } from 'node:crypto'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import type { Logger } from '@gighunter/core/logger'
import { feedbackChosenKeyboard, parseFeedbackCallbackData, type TelegramClient } from '@gighunter/core/notifier'
import type { Settings } from '@gighunter/core/schema'
import type { Secrets } from '@gighunter/core/secrets'
import type { Store } from '@gighunter/core/store'

export interface WebhookDeps {
  store: Store
  secrets: Secrets
  createTelegram: (token: string) => TelegramClient
  now: () => Date
  log: Logger
}

// Minimal Telegram Bot API update shapes used here.
interface TgChat { id: number; type: string; title?: string; first_name?: string }
interface TgUpdate {
  message?: { text?: string; chat: TgChat; from?: { username?: string; first_name?: string } }
  channel_post?: { chat: TgChat }
  my_chat_member?: { chat: TgChat; new_chat_member: { status: string } }
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: TgChat } }
}

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const text = (statusCode: number, body: string): APIGatewayProxyResultV2 => ({ statusCode, body })

export function createWebhookHandler(deps: WebhookDeps) {
  const saveChat = async (userId: string, settings: Settings, chatId: string | undefined, chatTitle: string | undefined) => {
    const { chatId: _c, chatTitle: _t, ...rest } = settings.telegram
    settings.telegram = { ...rest, ...(chatId ? { chatId, chatTitle } : {}) }
    settings.updatedAt = deps.now().toISOString()
    await deps.store.putSettings(userId, settings)
    deps.log.info('webhook.chat_updated', { userId, chatId })
  }

  const handleUpdate = async (userId: string, settings: Settings, update: TgUpdate) => {
    if (update.callback_query) {
      const cq = update.callback_query
      const token = await deps.secrets.getUserSecret(userId, 'telegram/bot-token')
      if (!token) return
      const tg = deps.createTelegram(token)
      const parsed = parseFeedbackCallbackData(cq.data ?? '')
      if (!parsed) {
        await tg.answerCallbackQuery(cq.id)
        return
      }
      const match = await deps.store.setMatchFeedback(userId, { platform: parsed.platform, externalId: parsed.externalId }, parsed.feedback, deps.now().toISOString())
      await tg.answerCallbackQuery(cq.id, match ? 'Thanks, noted!' : 'Job not found')
      if (match && cq.message) await tg.editMessageReplyMarkup(String(cq.message.chat.id), cq.message.message_id, feedbackChosenKeyboard(parsed.feedback))
      return
    }

    if (update.message?.chat.type === 'private' && update.message.text?.startsWith('/start')) {
      const chatId = String(update.message.chat.id)
      const who = update.message.from?.username ? `@${update.message.from.username}` : (update.message.from?.first_name ?? 'you')
      await saveChat(userId, settings, chatId, `DM with ${who}`)
      const token = await deps.secrets.getUserSecret(userId, 'telegram/bot-token')
      if (token) await deps.createTelegram(token).sendMessage(chatId, '✅ Connected. GigHunter notifications will arrive here.')
      return
    }

    if (update.my_chat_member) {
      const { chat, new_chat_member } = update.my_chat_member
      const chatId = String(chat.id)
      const isGroupLike = chat.type === 'channel' || chat.type === 'supergroup' || chat.type === 'group'
      if (new_chat_member.status === 'administrator' && isGroupLike) await saveChat(userId, settings, chatId, chat.title ?? chatId)
      else if ((new_chat_member.status === 'left' || new_chat_member.status === 'kicked') && settings.telegram.chatId === chatId) {
        await saveChat(userId, settings, undefined, undefined)
      }
      return
    }

    if (update.channel_post && !settings.telegram.chatId) {
      const { chat } = update.channel_post
      await saveChat(userId, settings, String(chat.id), chat.title ?? String(chat.id))
    }
  }

  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const userId = event.pathParameters?.userId
    if (!userId) return text(404, 'not found')
    const settings = await deps.store.getSettings(userId)
    const expected = settings?.telegram.webhookSecret
    const provided = event.headers['x-telegram-bot-api-secret-token'] ?? ''
    if (!settings || !expected || !safeEqual(provided, expected)) {
      deps.log.warn('webhook.forbidden', { userId })
      return text(403, 'forbidden')
    }
    let update: TgUpdate
    try {
      update = JSON.parse(event.body ?? '{}') as TgUpdate
    } catch {
      return text(400, 'bad json')
    }
    try {
      await handleUpdate(userId, settings, update)
    } catch (e) {
      // Always 200 to Telegram; otherwise it retries the same update indefinitely.
      deps.log.error('webhook.failed', { userId, err: e })
    }
    return text(200, 'ok')
  }
}
