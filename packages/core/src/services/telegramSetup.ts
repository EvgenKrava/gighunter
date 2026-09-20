import { randomBytes } from 'node:crypto'
import type { TelegramClient } from '../notifier/index'
import { defaultSettings, type Settings } from '../schema/index'
import type { Secrets } from '../secrets/index'
import type { Store } from '../store/index'
import { ServiceError } from './errors'

export interface TelegramSetupDeps {
  store: Store
  secrets: Secrets
  createTelegram: (token: string) => TelegramClient
  apiBaseUrl: string
  now: () => Date
}

export const TELEGRAM_ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member', 'channel_post']

export const webhookUrl = (apiBaseUrl: string, userId: string) => `${apiBaseUrl.replace(/\/+$/, '')}/telegram/webhook/${userId}`

async function loadSettings(deps: Pick<TelegramSetupDeps, 'store' | 'now'>, userId: string): Promise<Settings> {
  return (await deps.store.getSettings(userId)) ?? defaultSettings(deps.now().toISOString())
}

export async function connectTelegramBot(deps: TelegramSetupDeps, userId: string, token: string): Promise<Settings> {
  const tg = deps.createTelegram(token)
  const me = await tg.getMe() // TelegramError propagates; the API maps it to 400
  const secret = randomBytes(32).toString('hex')
  await tg.setWebhook(webhookUrl(deps.apiBaseUrl, userId), secret, TELEGRAM_ALLOWED_UPDATES)
  await deps.secrets.putUserSecret(userId, 'telegram/bot-token', token)

  const settings = await loadSettings(deps, userId)
  settings.telegram = { ...settings.telegram, tokenSet: true, tokenHint: token.slice(-4), botUsername: me.username, webhookSecret: secret }
  settings.updatedAt = deps.now().toISOString()
  await deps.store.putSettings(userId, settings)
  return settings
}

export async function disconnectTelegramBot(deps: TelegramSetupDeps, userId: string): Promise<Settings> {
  const token = await deps.secrets.getUserSecret(userId, 'telegram/bot-token')
  if (token) {
    try {
      await deps.createTelegram(token).deleteWebhook()
    } catch {
      /* token may already be revoked; still clear our side */
    }
  }
  await deps.secrets.deleteUserSecret(userId, 'telegram/bot-token')
  const settings = await loadSettings(deps, userId)
  settings.telegram = { tokenSet: false }
  settings.updatedAt = deps.now().toISOString()
  await deps.store.putSettings(userId, settings)
  return settings
}

export async function sendTelegramTest(deps: TelegramSetupDeps, userId: string): Promise<void> {
  const settings = await loadSettings(deps, userId)
  const token = settings.telegram.tokenSet ? await deps.secrets.getUserSecret(userId, 'telegram/bot-token') : null
  if (!token || !settings.telegram.chatId) throw new ServiceError('Connect a bot and a chat first', 400, 'telegram_not_configured')
  await deps.createTelegram(token).sendMessage(settings.telegram.chatId, '✅ GigHunter test message — notifications will arrive here.')
}
