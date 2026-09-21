import { z } from 'zod'
import { IsoDate, PlatformSchema } from './common'

export const JobBudgetSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  currency: z.string().min(1),
  type: z.enum(['fixed', 'hourly']),
  rateToUsd: z.number().positive().optional(), // USD per 1 unit of `currency`, when the platform reports it
})
export type JobBudget = z.infer<typeof JobBudgetSchema>

export const JobSchema = z.object({
  platform: PlatformSchema,
  externalId: z.string().min(1),
  url: z.url(),
  title: z.string(),
  description: z.string(),
  budget: JobBudgetSchema.nullable(),
  skills: z.array(z.string()),
  postedAt: IsoDate,
  language: z.string().optional(),
  client: z
    .object({
      country: z.string().optional(),
      rating: z.number().optional(),
      reviews: z.number().optional(),
      paymentVerified: z.boolean().optional(),
    })
    .optional(),
})
export type Job = z.infer<typeof JobSchema>
