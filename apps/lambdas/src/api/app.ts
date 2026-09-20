import { Hono } from 'hono'
import { requireAuth, type ApiEnv } from './auth'
import type { ApiDeps } from './deps'
import { errorHandler } from './errors'
import { profileRoutes } from './routes/profile'
import { runsRoutes } from './routes/runs'

export function createApp(deps: ApiDeps) {
  const app = new Hono<ApiEnv>()
  app.onError(errorHandler(deps.log))
  app.notFound((c) => c.json({ error: 'not found' }, 404))
  app.use('*', requireAuth)
  app.get('/me', (c) => c.json(c.get('user')))
  app.route('/', profileRoutes(deps))
  app.route('/', runsRoutes(deps))
  return app
}
