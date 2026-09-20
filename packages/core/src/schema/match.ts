import { z } from 'zod'
import { IsoDate, PlatformSchema } from './common'
import { JobSchema } from './job'

export const ScoreResultSchema = z.object({
  score: z.number().int().min(0).max(100),
  reasoning: z.string().min(1),
  estimatedHours: z.number().min(0),
  risks: z.array(z.string()).max(4),
})
export type ScoreResult = z.infer<typeof ScoreResultSchema>

export const VerdictSchema = z.enum(['strong', 'maybe', 'no'])
export type Verdict = z.infer<typeof VerdictSchema>

export const MatchStatusSchema = z.enum(['filtered', 'scored', 'pending', 'notified'])
export type MatchStatus = z.infer<typeof MatchStatusSchema>

export const FeedbackSchema = z.enum(['up', 'down'])
export type Feedback = z.infer<typeof FeedbackSchema>

export const MatchSchema = z.object({
  job: JobSchema,
  status: MatchStatusSchema,
  filterReason: z.string().optional(),
  score: ScoreResultSchema.optional(),
  verdict: VerdictSchema.optional(),
  feedback: FeedbackSchema.optional(),
  telegramMessageId: z.number().optional(),
  createdAt: IsoDate,
  scoredAt: IsoDate.optional(),
  notifiedAt: IsoDate.optional(),
  feedbackAt: IsoDate.optional(),
  ttl: z.number().int(),
})
export type Match = z.infer<typeof MatchSchema>

export const MatchRefSchema = z.object({ platform: PlatformSchema, externalId: z.string().min(1) })
export type MatchRef = z.infer<typeof MatchRefSchema>
