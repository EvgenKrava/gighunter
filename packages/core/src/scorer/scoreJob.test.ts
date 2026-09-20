import { describe, it, expect, vi } from 'vitest'
import { scoreJob, verdictFor, ScoringError } from './scoreJob'
import { SAMPLE_JOB } from '../prompts/index'
import type { LlmClient } from '../llm/index'

function fakeClient(parsed: unknown, usage = { input_tokens: 500, output_tokens: 80, cache_read_input_tokens: 1200, cache_creation_input_tokens: 0 }) {
  const parse = vi.fn().mockResolvedValue({ parsed_output: parsed, usage, stop_reason: 'end_turn' })
  const client = { messages: { create: vi.fn(), parse } } as unknown as LlmClient
  return { client, parse }
}

describe('verdictFor', () => {
  it('maps thresholds', () => {
    expect(verdictFor(80)).toBe('strong'); expect(verdictFor(79)).toBe('maybe'); expect(verdictFor(50)).toBe('maybe'); expect(verdictFor(49)).toBe('no')
  })
})

describe('scoreJob', () => {
  it('sends system prompt with cache_control and the rendered job, returns normalized result + usage', async () => {
    const { client, parse } = fakeClient({ score: 82.4, reasoning: ' Great fit. ', estimatedHours: 3, risks: ['a', 'b', 'c', 'd', 'e'] })
    const out = await scoreJob({ client, model: 'm', systemPrompt: 'SYS', job: SAMPLE_JOB })
    const params = parse.mock.calls[0]![0] as Record<string, unknown>
    expect(params.model).toBe('m')
    expect(params.system).toEqual([{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }])
    expect((params.messages as { content: string }[])[0]!.content).toContain(SAMPLE_JOB.title)
    expect(params).toHaveProperty('output_config.format')
    expect(out.result).toEqual({ score: 82, reasoning: 'Great fit.', estimatedHours: 3, risks: ['a', 'b', 'c', 'd'] })
    expect(out.verdict).toBe('strong')
    expect(out.usage).toEqual({ inputTokens: 1700, outputTokens: 80 })
  })
  it('clamps score into 0..100', async () => {
    const { client } = fakeClient({ score: 140, reasoning: 'x', estimatedHours: -2, risks: [] })
    const out = await scoreJob({ client, model: 'm', systemPrompt: 'S', job: SAMPLE_JOB })
    expect(out.result.score).toBe(100)
    expect(out.result.estimatedHours).toBe(0)
  })
  it('throws ScoringError when parsed_output is null', async () => {
    const { client } = fakeClient(null)
    await expect(scoreJob({ client, model: 'm', systemPrompt: 'S', job: SAMPLE_JOB })).rejects.toBeInstanceOf(ScoringError)
  })
})
