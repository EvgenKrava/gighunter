import { z } from 'zod'
import { IsoDate } from './common'

export const QuickActionSchema = z.object({ label: z.string().min(1).max(40), text: z.string().min(1).max(2000) })
export type QuickAction = z.infer<typeof QuickActionSchema>

const uniqueLabels = (qa: QuickAction[]) => new Set(qa.map((q) => q.label)).size === qa.length
const QuickActionsSchema = z.array(QuickActionSchema).min(1).max(8).refine(uniqueLabels, { message: 'quick action labels must be unique' })
const Template = z.string().trim().min(1).max(8000)

export const PromptsSchema = z.object({
  scoring: Template.optional(),
  chat: Template.optional(),
  quickActions: QuickActionsSchema.optional(),
  updatedAt: IsoDate,
})
export type Prompts = z.infer<typeof PromptsSchema>

export const PromptsPatchSchema = z.strictObject({
  scoring: Template.nullable().optional(),
  chat: Template.nullable().optional(),
  quickActions: QuickActionsSchema.nullable().optional(),
})
export type PromptsPatch = z.infer<typeof PromptsPatchSchema>
