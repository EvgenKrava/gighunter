import { Hono } from 'hono'
import { z } from 'zod'
import { buildChatSystemPrompt, buildScoringSystemPrompt, DEFAULT_CHAT_PROMPT, DEFAULT_QUICK_ACTIONS, DEFAULT_SCORING_PROMPT, SAMPLE_MATCH } from '@gighunter/core/prompts'
import { PromptsPatchSchema, type Prompts } from '@gighunter/core/schema'
import type { ApiEnv } from '../auth'
import type { ApiDeps } from '../deps'
import { HttpError } from '../errors'

const PLACEHOLDERS = ['{{app_context}}', '{{profile}}', '{{job}}', '{{score}}']
const PreviewBody = z.object({ kind: z.enum(['scoring', 'chat']), template: z.string().max(8000) })

export function promptsRoutes(deps: ApiDeps) {
  const r = new Hono<ApiEnv>()

  r.get('/prompts', async (c) => {
    const overrides = (await deps.store.getPrompts(c.get('user').sub)) ?? {}
    return c.json({
      defaults: { scoring: DEFAULT_SCORING_PROMPT, chat: DEFAULT_CHAT_PROMPT, quickActions: DEFAULT_QUICK_ACTIONS },
      overrides,
      placeholders: PLACEHOLDERS,
    })
  })

  r.put('/prompts', async (c) => {
    const sub = c.get('user').sub
    const patch = PromptsPatchSchema.parse(await c.req.json())
    const current: Prompts = (await deps.store.getPrompts(sub)) ?? { updatedAt: deps.now().toISOString() }
    const next: Prompts = { ...current, updatedAt: deps.now().toISOString() }
    for (const key of ['scoring', 'chat', 'quickActions'] as const) {
      const value = patch[key]
      if (value === undefined) continue
      if (value === null) delete next[key]
      else (next as Record<string, unknown>)[key] = value
    }
    await deps.store.putPrompts(sub, next)
    return c.json(next)
  })

  r.post('/prompts/preview', async (c) => {
    const { kind, template } = PreviewBody.parse(await c.req.json())
    const profile = await deps.store.getProfile(c.get('user').sub)
    if (!profile) throw new HttpError(400, 'Fill in your profile first', 'profile_missing')
    const rendered = kind === 'scoring' ? buildScoringSystemPrompt(template, profile) : buildChatSystemPrompt(template, profile, SAMPLE_MATCH)
    return c.json({ rendered })
  })

  return r
}
