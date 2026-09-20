import type Anthropic from '@anthropic-ai/sdk'
import { supportsAdaptiveThinking, usageFrom, type CreateParams, type LlmClient } from '../llm/index'
import type { ChatMessage, Usage } from '../schema/index'

export class ChatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatError'
  }
}

export async function runChatTurn(args: {
  client: LlmClient
  model: string
  systemPrompt: string
  history: ChatMessage[]
  userMessage: string
}): Promise<{ reply: string; truncated: boolean; usage: Usage }> {
  const messages: Anthropic.MessageParam[] = [
    ...args.history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: args.userMessage },
  ]
  const params: CreateParams = {
    model: args.model,
    max_tokens: 4096,
    system: [{ type: 'text', text: args.systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages,
  }
  if (supportsAdaptiveThinking(args.model)) params.thinking = { type: 'adaptive' }

  const res = await args.client.messages.create(params)
  const reply = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
  if (!reply) throw new ChatError(`model returned no text (stop_reason=${res.stop_reason})`)
  return { reply, truncated: res.stop_reason === 'max_tokens', usage: usageFrom(res.usage) }
}
