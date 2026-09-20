import { runChatTurn } from '../chat/index'
import type { LlmClient } from '../llm/index'
import { buildChatSystemPrompt, resolvePrompts } from '../prompts/index'
import { CHAT_MAX_BYTES, CHAT_MAX_MESSAGES, defaultSettings, type Chat, type MatchRef, type Usage } from '../schema/index'
import { CHAT_TTL_DAYS, ttlAfterDays, type Store } from '../store/index'
import { ServiceError } from './errors'

export interface ChatServiceDeps {
  store: Store
  createLlm: (model: string) => LlmClient
  now: () => Date
}

export async function sendChatMessage(
  deps: ChatServiceDeps,
  userId: string,
  ref: MatchRef,
  message: string,
): Promise<{ reply: string; truncated: boolean; usage: Usage; chat: Chat }> {
  const nowIso = deps.now().toISOString()
  const [match, profile, settingsOrNull, promptsOverride, existing] = await Promise.all([
    deps.store.getMatch(userId, ref),
    deps.store.getProfile(userId),
    deps.store.getSettings(userId),
    deps.store.getPrompts(userId),
    deps.store.getChat(userId, ref),
  ])
  if (!match) throw new ServiceError('Job not found', 404, 'match_not_found')
  if (!profile) throw new ServiceError('Fill in your profile first', 400, 'profile_missing')
  const settings = settingsOrNull ?? defaultSettings(nowIso)
  const chat: Chat = existing ?? {
    messages: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    createdAt: nowIso,
    updatedAt: nowIso,
    ttl: ttlAfterDays(nowIso, CHAT_TTL_DAYS),
  }

  if (chat.messages.length + 2 > CHAT_MAX_MESSAGES || Buffer.byteLength(JSON.stringify(chat)) > CHAT_MAX_BYTES) {
    throw new ServiceError('This chat is full — reset it to continue', 409, 'chat_full')
  }

  const prompts = resolvePrompts(promptsOverride)
  const systemPrompt = buildChatSystemPrompt(prompts.chat, profile, match)
  const turn = await runChatTurn({
    client: deps.createLlm(settings.chatModel),
    model: settings.chatModel,
    systemPrompt,
    history: chat.messages,
    userMessage: message,
  })

  chat.messages.push({ role: 'user', content: message, at: nowIso }, { role: 'assistant', content: turn.reply, at: deps.now().toISOString() })
  chat.usage = { inputTokens: chat.usage.inputTokens + turn.usage.inputTokens, outputTokens: chat.usage.outputTokens + turn.usage.outputTokens }
  chat.updatedAt = deps.now().toISOString()
  await deps.store.putChat(userId, ref, chat)
  return { reply: turn.reply, truncated: turn.truncated, usage: turn.usage, chat }
}
