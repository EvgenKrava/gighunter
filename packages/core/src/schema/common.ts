import { z } from 'zod'

export const PlatformSchema = z.enum(['freelancer', 'upwork'])
export type Platform = z.infer<typeof PlatformSchema>

export const UsageSchema = z.object({ inputTokens: z.number().int().min(0), outputTokens: z.number().int().min(0) })
export type Usage = z.infer<typeof UsageSchema>

export const IsoDate = z.string().min(20)
