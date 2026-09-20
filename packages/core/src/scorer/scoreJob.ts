import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { LlmClient } from '../llm/index'
import { usageFrom } from '../llm/index'
import { renderJob } from '../prompts/index'
import { ScoreResultSchema, type Job, type ScoreResult, type Usage, type Verdict } from '../schema/index'

/** What the model is asked to produce. Numeric bounds are enforced after the call (structured outputs do not support min/max). */
export const ScoreOutputSchema = z.object({
  score: z.number().int().describe('Fit score from 0 (no fit) to 100 (perfect evening gig)'),
  reasoning: z.string().describe('1-3 sentences explaining the score, written to be scanned on a phone'),
  estimatedHours: z.number().describe('Estimated hours the developer needs to deliver'),
  risks: z.array(z.string()).describe('Up to 4 short, concrete risks; empty array if none'),
})
type ScoreOutput = z.infer<typeof ScoreOutputSchema>

export class ScoringError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScoringError'
  }
}

export function verdictFor(score: number): Verdict {
  return score >= 80 ? 'strong' : score >= 50 ? 'maybe' : 'no'
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export async function scoreJob(args: {
  client: LlmClient
  model: string
  systemPrompt: string
  job: Job
}): Promise<{ result: ScoreResult; verdict: Verdict; usage: Usage }> {
  const response = await args.client.messages.parse<ScoreOutput>({
    model: args.model,
    max_tokens: 1024,
    system: [{ type: 'text', text: args.systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: renderJob(args.job) }],
    output_config: { format: zodOutputFormat(ScoreOutputSchema) },
  })
  const raw = response.parsed_output
  if (!raw) throw new ScoringError(`model returned no parseable output (stop_reason=${response.stop_reason})`)
  const result = ScoreResultSchema.parse({
    score: clamp(Math.round(raw.score), 0, 100),
    reasoning: raw.reasoning.trim() || 'No reasoning provided.',
    estimatedHours: Math.max(0, raw.estimatedHours),
    risks: raw.risks.slice(0, 4),
  })
  return { result, verdict: verdictFor(result.score), usage: usageFrom(response.usage) }
}
