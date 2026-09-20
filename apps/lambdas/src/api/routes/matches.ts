import { Hono } from 'hono'
import { z } from 'zod'
import { FeedbackSchema, MatchRefSchema, MatchStatusSchema } from '@gighunter/core/schema'
import { sendChatMessage } from '@gighunter/core/services'
import type { ApiEnv } from '../auth'
import type { ApiDeps } from '../deps'
import { HttpError } from '../errors'

const ListQuery = z.object({
  status: MatchStatusSchema.default('notified'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
})
const FeedbackBody = z.object({ feedback: FeedbackSchema })
const ChatBody = z.object({ message: z.string().trim().min(1).max(4000) })

export function matchesRoutes(deps: ApiDeps) {
  const r = new Hono<ApiEnv>()
  const refOf = (c: { req: { param: (k: string) => string | undefined } }) =>
    MatchRefSchema.parse({ platform: c.req.param('platform'), externalId: c.req.param('id') })

  r.get('/matches', async (c) => {
    const q = ListQuery.parse(c.req.query())
    return c.json(await deps.store.listMatches(c.get('user').sub, q.status, { limit: q.limit, cursor: q.cursor }))
  })

  r.get('/matches/:platform/:id', async (c) => {
    const sub = c.get('user').sub
    const ref = refOf(c)
    const match = await deps.store.getMatch(sub, ref)
    if (!match) throw new HttpError(404, 'Job not found', 'match_not_found')
    const chat = await deps.store.getChat(sub, ref)
    return c.json({ match, chat })
  })

  r.post('/matches/:platform/:id/feedback', async (c) => {
    const { feedback } = FeedbackBody.parse(await c.req.json())
    const match = await deps.store.setMatchFeedback(c.get('user').sub, refOf(c), feedback, deps.now().toISOString())
    if (!match) throw new HttpError(404, 'Job not found', 'match_not_found')
    return c.json(match)
  })

  r.post('/matches/:platform/:id/chat', async (c) => {
    const { message } = ChatBody.parse(await c.req.json())
    const { reply, truncated, usage } = await sendChatMessage(deps, c.get('user').sub, refOf(c), message)
    return c.json({ reply, truncated, usage })
  })

  r.delete('/matches/:platform/:id/chat', async (c) => {
    await deps.store.deleteChat(c.get('user').sub, refOf(c))
    return c.body(null, 204)
  })

  return r
}
