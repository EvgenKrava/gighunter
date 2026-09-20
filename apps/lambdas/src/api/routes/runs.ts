import { Hono } from 'hono'
import type { ApiEnv } from '../auth'
import type { ApiDeps } from '../deps'

export function runsRoutes(deps: ApiDeps) {
  const r = new Hono<ApiEnv>()
  r.get('/runs', async (c) => {
    const requested = Number(c.req.query('limit') ?? 10)
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(50, Math.floor(requested)) : 10
    return c.json(await deps.store.listRuns(c.get('user').sub, limit))
  })
  r.post('/runs', async (c) => {
    await deps.invokePoller(c.get('user').sub)
    return c.json({ status: 'queued' }, 202)
  })
  return r
}
