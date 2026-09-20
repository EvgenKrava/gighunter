import { buildCoreDeps } from '../shared/deps'
import { createWebhookHandler } from './handler'

const deps = buildCoreDeps('tg-webhook')
export const handler = createWebhookHandler({ store: deps.store, secrets: deps.secrets, createTelegram: deps.createTelegram, now: deps.now, log: deps.log })
