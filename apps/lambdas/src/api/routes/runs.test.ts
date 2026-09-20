import { describe, it, expect } from 'vitest'
import { createApp } from '../app'
import { makeApiDeps, authed } from '../test-utils'

describe('/runs', () => {
  it('GET lists runs with limit capped at 50', async () => {
    const deps = makeApiDeps()
    await createApp(deps).request('/runs?limit=500', {}, authed('s'))
    expect(deps.store.listRuns).toHaveBeenCalledWith('s', 50)
    await createApp(deps).request('/runs', {}, authed('s'))
    expect(deps.store.listRuns).toHaveBeenLastCalledWith('s', 10)
  })
  it('POST invokes the poller for the caller and returns 202', async () => {
    const deps = makeApiDeps()
    const res = await createApp(deps).request('/runs', { method: 'POST' }, authed('s'))
    expect(res.status).toBe(202)
    expect(deps.invokePoller).toHaveBeenCalledWith('s')
  })
})
