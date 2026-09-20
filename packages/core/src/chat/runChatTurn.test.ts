import { describe, it, expect, vi } from 'vitest'
import { runChatTurn, ChatError } from './runChatTurn'
import type { LlmClient } from '../llm/index'

function fakeClient(content: { type: string; text?: string }[], stop = 'end_turn') {
  const create = vi.fn().mockResolvedValue({ content, stop_reason: stop, usage: { input_tokens: 300, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 900 } })
  return { client: { messages: { create, parse: vi.fn() } } as unknown as LlmClient, create }
}
const history = [
  { role: 'user' as const, content: 'hi', at: '2026-09-20T10:00:00.000Z' },
  { role: 'assistant' as const, content: 'hello', at: '2026-09-20T10:00:01.000Z' },
]

describe('runChatTurn', () => {
  it('passes history in order, appends the new user message, joins text blocks', async () => {
    const { client, create } = fakeClient([{ type: 'text', text: 'Part 1' }, { type: 'text', text: 'Part 2' }])
    const out = await runChatTurn({ client, model: 'global.anthropic.claude-haiku-4-5-20251001-v1:0', systemPrompt: 'S', history, userMessage: 'draft' })
    const params = create.mock.calls[0]![0]
    expect(params.messages).toEqual([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: 'draft' }])
    expect(params.system).toEqual([{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }])
    expect(params.thinking).toBeUndefined()
    expect(out).toEqual({ reply: 'Part 1\nPart 2', truncated: false, usage: { inputTokens: 1200, outputTokens: 120 } })
  })
  it('enables adaptive thinking for 4.6+ models and flags truncation', async () => {
    const { client, create } = fakeClient([{ type: 'text', text: 'cut' }], 'max_tokens')
    const out = await runChatTurn({ client, model: 'anthropic.claude-sonnet-5', systemPrompt: 'S', history: [], userMessage: 'x' })
    expect(create.mock.calls[0]![0].thinking).toEqual({ type: 'adaptive' })
    expect(out.truncated).toBe(true)
  })
  it('throws ChatError on empty reply', async () => {
    const { client } = fakeClient([])
    await expect(runChatTurn({ client, model: 'm', systemPrompt: 'S', history: [], userMessage: 'x' })).rejects.toBeInstanceOf(ChatError)
  })
})
