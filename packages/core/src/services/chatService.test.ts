import { describe, it, expect, vi } from 'vitest'
import { defaultProfileFilters } from '../schema/index'
import { sendChatMessage } from './chatService'
import { defaultSettings, CHAT_MAX_MESSAGES } from '../schema/index'
import { SAMPLE_MATCH } from '../prompts/index'
import type { Store } from '../store/index'
import type { LlmClient } from '../llm/index'

const nowIso = '2026-09-20T10:00:00.000Z'
const now = () => new Date(nowIso)
const profile = { displayName: 'Yev', skills: [], budget: { min: 1, max: 9, currency: 'USD' as const }, maxHours: 4, languages: ['en'], stopWords: [], freeText: '', filters: defaultProfileFilters(), updatedAt: nowIso }
const ref = { platform: 'freelancer' as const, externalId: 'sample-1' }

function makeDeps(opts: { match?: unknown; chat?: unknown; reply?: string } = {}) {
  const store = {
    getMatch: vi.fn().mockResolvedValue(opts.match === undefined ? SAMPLE_MATCH : opts.match),
    getProfile: vi.fn().mockResolvedValue(profile),
    getSettings: vi.fn().mockResolvedValue({ ...defaultSettings(nowIso), chatModel: 'anthropic.claude-sonnet-5' }),
    getPrompts: vi.fn().mockResolvedValue(null),
    getChat: vi.fn().mockResolvedValue(opts.chat ?? null),
    putChat: vi.fn(),
  } as unknown as Store
  const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: opts.reply ?? 'Here is a draft.' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  const createLlm = vi.fn().mockReturnValue({ messages: { create, parse: vi.fn() } } as unknown as LlmClient)
  return { deps: { store, createLlm, now }, store, create, createLlm }
}

describe('sendChatMessage', () => {
  it('builds the system prompt from profile/job/score, runs a turn with the chat model and persists both messages', async () => {
    const { deps, store, create, createLlm } = makeDeps()
    const out = await sendChatMessage(deps, 'u1', ref, 'Draft a proposal')
    expect(createLlm).toHaveBeenCalledWith('anthropic.claude-sonnet-5')
    const params = create.mock.calls[0]![0]
    expect(params.system[0].text).toContain(SAMPLE_MATCH.job.title)
    expect(params.system[0].text).toContain('Score: 82/100')
    expect(params.messages).toEqual([{ role: 'user', content: 'Draft a proposal' }])
    expect(out.reply).toBe('Here is a draft.')
    expect(out.chat.messages).toEqual([
      { role: 'user', content: 'Draft a proposal', at: nowIso },
      { role: 'assistant', content: 'Here is a draft.', at: nowIso },
    ])
    expect(out.chat.usage).toEqual({ inputTokens: 100, outputTokens: 50 })
    expect(store.putChat).toHaveBeenCalledWith('u1', ref, out.chat)
  })
  it('404 when the match does not exist', async () => {
    const { deps } = makeDeps({ match: null })
    await expect(sendChatMessage(deps, 'u1', ref, 'x')).rejects.toMatchObject({ status: 404, code: 'match_not_found' })
  })
  it('409 when the chat is full and nothing is persisted', async () => {
    const full = { messages: Array.from({ length: CHAT_MAX_MESSAGES }, () => ({ role: 'user', content: 'm', at: nowIso })), usage: { inputTokens: 0, outputTokens: 0 }, createdAt: nowIso, updatedAt: nowIso, ttl: 1 }
    const { deps, store } = makeDeps({ chat: full })
    await expect(sendChatMessage(deps, 'u1', ref, 'x')).rejects.toMatchObject({ status: 409, code: 'chat_full' })
    expect(store.putChat).not.toHaveBeenCalled()
  })
  it('does not persist when the model call fails', async () => {
    const { deps, store, create } = makeDeps()
    create.mockRejectedValue(new Error('bedrock down'))
    await expect(sendChatMessage(deps, 'u1', ref, 'x')).rejects.toThrow('bedrock down')
    expect(store.putChat).not.toHaveBeenCalled()
  })
})
