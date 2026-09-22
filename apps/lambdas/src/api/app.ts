import { Hono } from 'hono'
import { requireAuth, type ApiEnv } from './auth'
import type { ApiDeps } from './deps'
import { errorHandler } from './errors'
import { accountRoutes } from './routes/account'
import { matchesRoutes } from './routes/matches'
import { profileRoutes } from './routes/profile'
import { promptsRoutes } from './routes/prompts'
import { runsRoutes } from './routes/runs'
import { settingsRoutes } from './routes/settings'

export function createApp(deps: ApiDeps) {
  const app = new Hono<ApiEnv>()
  app.onError(errorHandler(deps.log))
  app.notFound((c) => c.json({ error: 'not found' }, 404))
  // CORS preflight: API Gateway attaches the CORS headers; the browser only needs a 2xx before auth.
  app.options('*', (c) => c.body(null, 204))
  app.use('*', requireAuth)
  app.get('/me', (c) => c.json(c.get('user')))
  app.route('/', accountRoutes(deps))
  app.route('/', profileRoutes(deps))
  app.route('/', settingsRoutes(deps))
  app.route('/', promptsRoutes(deps))
  app.route('/', matchesRoutes(deps))
  app.route('/', runsRoutes(deps))
  return app
}
