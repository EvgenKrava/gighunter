import { z } from 'zod'
import { IsoDate } from './common'

export const SkillLevelSchema = z.enum(['basic', 'solid', 'expert'])

/** Deterministic pre-AI filters (spec §8). Every field has a permissive default so older profiles keep parsing. */
export const ProfileFiltersSchema = z.object({
  mustHaveAny: z.array(z.string().min(1).max(50)).max(50).default([]), // empty = no keyword requirement
  jobTypes: z.array(z.enum(['fixed', 'hourly'])).min(1).default(['fixed', 'hourly']),
  minHourlyRate: z.number().min(0).optional(), // hourly jobs whose max rate is below this are dropped
  requirePaymentVerified: z.boolean().default(false),
  minClientRating: z.number().min(0).max(5).optional(),
  minClientReviews: z.number().int().min(0).optional(),
})
export type ProfileFilters = z.infer<typeof ProfileFiltersSchema>
export const defaultProfileFilters = (): ProfileFilters => ProfileFiltersSchema.parse({})

export const ProfileInputSchema = z.object({
  displayName: z.string().min(1).max(100),
  skills: z.array(z.object({ name: z.string().min(1).max(50), level: SkillLevelSchema })).max(100),
  budget: z
    .object({ min: z.number().min(0), max: z.number().min(0), currency: z.literal('USD') })
    .refine((b) => b.max >= b.min, { message: 'budget.max must be >= budget.min' }),
  maxHours: z.number().positive().max(200),
  languages: z.array(z.string().length(2)).min(1).max(10),
  stopWords: z.array(z.string().min(1).max(50)).max(100),
  freeText: z.string().max(4000),
  filters: ProfileFiltersSchema.prefault({}),
})
export const ProfileSchema = ProfileInputSchema.extend({ updatedAt: IsoDate })
export type ProfileInput = z.infer<typeof ProfileInputSchema>
export type Profile = z.infer<typeof ProfileSchema>
