import { describe, it, expect, vi } from 'vitest'
import { createApp } from '../app'
import { makeApiDeps, authed, anonymous } from '../test-utils'

describe('DELETE /me', () => {
  it('wipes the caller and responds 204', async () => {
    const deps = makeApiDeps({ store: { deleteUser: vi.fn().mockResolvedValue(undefined) } })
    const res = await createApp(deps).request('/me', { method: 'DELETE' }, authed('sub-9'))
    expect(res.status).toBe(204)
    expect(deps.store.deleteUser).toHaveBeenCalledWith('sub-9')
    expect(deps.deleteIdentity).toHaveBeenCalledWith('sub-9')
  })
  it('401 without a JWT', async () => {
    const res = await createApp(makeApiDeps()).request('/me', { method: 'DELETE' }, anonymous())
    expect(res.status).toBe(401)
  })
  it('500 and no identity deletion when data deletion fails', async () => {
    const deps = makeApiDeps({ store: { deleteUser: vi.fn().mockRejectedValue(new Error('ddb down')) } })
    const res = await createApp(deps).request('/me', { method: 'DELETE' }, authed())
    expect(res.status).toBe(500)
    expect(deps.deleteIdentity).not.toHaveBeenCalled()
  })
})
