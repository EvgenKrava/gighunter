import { describe, it, expect, vi } from 'vitest'
import { createPollerHandler } from './handler'
import { createLogger } from '@gighunter/core/logger'
import type { PipelineDeps } from '@gighunter/core/pipeline'

function makeDeps(users: string[]) {
  return { store: { listActiveUsers: vi.fn().mockResolvedValue(users) }, log: createLogger({}, () => {}) } as unknown as PipelineDeps
}

describe('poller handler', () => {
  it('runs every active user on schedule and isolates failures', async () => {
    const deps = makeDeps(['a', 'b', 'c'])
    const run = vi.fn()
      .mockResolvedValueOnce({ errors: [] })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ errors: ['x'] })
    const out = await createPollerHandler(deps, run as never)({ trigger: 'schedule' })
    expect(run.mock.calls.map((c) => [c[1], c[2]])).toEqual([['a', 'schedule'], ['b', 'schedule'], ['c', 'schedule']])
    expect(out).toEqual({ processed: 3, results: [{ userId: 'a', errors: 0 }, { userId: 'b', errors: -1 }, { userId: 'c', errors: 1 }] })
  })
  it('runs only the given user on manual trigger', async () => {
    const deps = makeDeps(['a', 'b'])
    const run = vi.fn().mockResolvedValue({ errors: [] })
    const out = await createPollerHandler(deps, run as never)({ trigger: 'manual', userId: 'z' })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]![1]).toBe('z')
    expect(out.processed).toBe(1)
  })
})
