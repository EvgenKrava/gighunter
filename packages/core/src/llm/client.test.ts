import { describe, it, expect } from 'vitest'
import { usesMantle, supportsAdaptiveThinking, usageFrom } from './client'

describe('model routing', () => {
  it.each([
    ['global.anthropic.claude-haiku-4-5-20251001-v1:0', false, false],
    ['global.anthropic.claude-sonnet-4-6', false, true],
    ['global.anthropic.claude-opus-4-6-v1', false, true],
    ['anthropic.claude-sonnet-5', true, true],
    ['anthropic.claude-opus-5', true, true],
    ['anthropic.claude-opus-4-7', true, true],
  ])('%s → mantle=%s adaptive=%s', (id, mantle, adaptive) => {
    expect(usesMantle(id)).toBe(mantle)
    expect(supportsAdaptiveThinking(id)).toBe(adaptive)
  })
})

describe('usageFrom', () => {
  it('sums all input token kinds', () => {
    expect(usageFrom({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 } as never))
      .toEqual({ inputTokens: 130, outputTokens: 5 })
    expect(usageFrom({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: null, cache_creation_input_tokens: null } as never))
      .toEqual({ inputTokens: 10, outputTokens: 5 })
  })
})
