import { Hono } from 'hono'
import { ProfileInputSchema } from '@gighunter/core/schema'
import type { ApiEnv } from '../auth'
import type { ApiDeps } from '../deps'

export function profileRoutes(deps: ApiDeps) {
  const r = new Hono<ApiEnv>()
  r.get('/profile', async (c) => {
    const profile = await deps.store.getProfile(c.get('user').sub)
    return profile ? c.json(profile) : c.json({ error: 'profile not set', code: 'profile_missing' }, 404)
  })
  r.put('/profile', async (c) => {
    const input = ProfileInputSchema.parse(await c.req.json())
    const profile = { ...input, updatedAt: deps.now().toISOString() }
    await deps.store.putProfile(c.get('user').sub, profile)
    return c.json(profile)
  })
  return r
}
