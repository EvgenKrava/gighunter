import { Hono } from 'hono'
import { deleteAccount } from '@gighunter/core/services'
import type { ApiEnv } from '../auth'
import type { ApiDeps } from '../deps'

export function accountRoutes(deps: ApiDeps) {
  const r = new Hono<ApiEnv>()
  // Only the caller's own account: the JWT sub is the only identity we ever act on.
  r.delete('/me', async (c) => {
    const { sub, email } = c.get('user')
    await deleteAccount(deps, sub)
    deps.log.info('account.deleted', { sub, email })
    return c.body(null, 204)
  })
  return r
}
