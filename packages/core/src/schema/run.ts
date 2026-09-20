import { z } from 'zod'
import { IsoDate, UsageSchema } from './common'

export const RunPlatformStatsSchema = z.object({
  fetched: z.number().int().default(0),
  new: z.number().int().default(0),
  filtered: z.number().int().default(0),
  scored: z.number().int().default(0),
  notified: z.number().int().default(0),
  error: z.string().optional(),
})
export type RunPlatformStats = z.infer<typeof RunPlatformStatsSchema>
export const emptyPlatformStats = (): RunPlatformStats => ({ fetched: 0, new: 0, filtered: 0, scored: 0, notified: 0 })

export const RunSchema = z.object({
  startedAt: IsoDate,
  finishedAt: IsoDate.optional(),
  trigger: z.enum(['schedule', 'manual']),
  perPlatform: z.record(z.string(), RunPlatformStatsSchema),
  usage: UsageSchema,
  errors: z.array(z.string()),
  ttl: z.number().int(),
})
export type Run = z.infer<typeof RunSchema>
