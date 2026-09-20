import { z } from 'zod'
import { IsoDate } from './common'

export const DEFAULT_MODEL = 'global.anthropic.claude-haiku-4-5-20251001-v1:0'

export const KNOWN_MODELS: { id: string; label: string }[] = [
  { id: DEFAULT_MODEL, label: 'Claude Haiku 4.5 (fast, cheapest)' },
  { id: 'global.anthropic.claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'global.anthropic.claude-opus-4-6-v1', label: 'Claude Opus 4.6' },
  { id: 'anthropic.claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'anthropic.claude-opus-5', label: 'Claude Opus 5' },
]

export const TelegramSettingsSchema = z.object({
  tokenSet: z.boolean().default(false),
  tokenHint: z.string().optional(),
  botUsername: z.string().optional(),
  webhookSecret: z.string().optional(),
  chatId: z.string().optional(),
  chatTitle: z.string().optional(),
})

export const FreelancerSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  query: z.string().max(200).default(''),
  tokenSet: z.boolean().default(false),
  tokenHint: z.string().optional(),
  connectedAs: z.string().optional(),
})

export const SettingsSchema = z.object({
  active: z.boolean().default(false),
  notifyThreshold: z.number().int().min(0).max(100).default(70),
  maxJobAgeHours: z.number().int().min(1).max(168).default(24),
  model: z.string().min(1).default(DEFAULT_MODEL),
  chatModel: z.string().min(1).default(DEFAULT_MODEL),
  telegram: TelegramSettingsSchema.prefault({}),
  platforms: z
    .object({
      freelancer: FreelancerSettingsSchema.prefault({}),
      upwork: z.object({ enabled: z.literal(false).default(false) }).prefault({}),
    })
    .prefault({}),
  updatedAt: IsoDate,
})
export type Settings = z.infer<typeof SettingsSchema>

export const SettingsPatchSchema = z.strictObject({
  active: z.boolean().optional(),
  notifyThreshold: z.number().int().min(0).max(100).optional(),
  maxJobAgeHours: z.number().int().min(1).max(168).optional(),
  model: z.string().min(1).max(120).optional(),
  chatModel: z.string().min(1).max(120).optional(),
  platforms: z
    .strictObject({
      freelancer: z.strictObject({ enabled: z.boolean().optional(), query: z.string().max(200).optional() }).optional(),
    })
    .optional(),
  telegram: z.strictObject({ chatId: z.string().max(64).optional() }).optional(),
})
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

export function defaultSettings(now: string): Settings {
  return SettingsSchema.parse({ updatedAt: now })
}
