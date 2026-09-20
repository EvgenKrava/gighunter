import { z } from 'zod'
import { IsoDate, UsageSchema } from './common'

export const CHAT_MAX_MESSAGES = 200
export const CHAT_MAX_BYTES = 300_000

export const ChatMessageSchema = z.object({ role: z.enum(['user', 'assistant']), content: z.string(), at: IsoDate })
export type ChatMessage = z.infer<typeof ChatMessageSchema>

export const ChatSchema = z.object({
  messages: z.array(ChatMessageSchema),
  usage: UsageSchema,
  createdAt: IsoDate,
  updatedAt: IsoDate,
  ttl: z.number().int(),
})
export type Chat = z.infer<typeof ChatSchema>
