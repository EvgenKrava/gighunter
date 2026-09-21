import { describe, it, expect, vi } from 'vitest'
import { createPollerHandler, isDue } from './handler'
import { createLogger } from '@gighunter/core/logger'
import type { PipelineDeps } from '@gighunter/core/pipeline'

const nowIso = '2026-09-21T10:00:00.000Z'
const due = { active: true, pollIntervalMinutes: 15 }
function makeDeps(users: string[], settings: Record<string, unknown> = {}) {
  return {
    store: { listActiveUsers: vi.fn().mockResolvedValue(users), getSettings: vi.fn().mockImplementation(async (u: string) => settings[u] ?? due) },
    log: createLogger({}, () => {}),
    now: () => new Date(nowIso),
  } as unknown as PipelineDeps
}

describe('isDue', () => {
  const now = new Date(nowIso)
  it('inactive or missing settings → never', () => {
    expect(isDue(null, now)).toBe(false)
    expect(isDue({ active: false, pollIntervalMinutes: 15 }, now)).toBe(false)
  })
  it('never polled → due; interval elapsed → due; not elapsed → not due', () => {
    expect(isDue({ active: true, pollIntervalMinutes: 60 }, now)).toBe(true)
    expect(isDue({ active: true, pollIntervalMinutes: 60, lastPolledAt: '2026-09-21T08:59:00.000Z' }, now)).toBe(true)
    expect(isDue({ active: true, pollIntervalMinutes: 60, lastPolledAt: '2026-09-21T09:30:00.000Z' }, now)).toBe(false)
    expect(isDue({ active: true, pollIntervalMinutes: 15, lastPolledAt: '2026-09-21T09:45:20.000Z' }, now)).toBe(true) // 14m40s + 30 s slack
  })
})

describe('poller handler', () => {
  it('runs every due user on schedule and isolates failures', async () => {
    const deps = makeDeps(['a', 'b', 'c'])
    const run = vi.fn()
      .mockResolvedValueOnce({ errors: [] })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ errors: ['x'] })
    const out = await createPollerHandler(deps, run as never)({ trigger: 'schedule' })
    expect(run.mock.calls.map((c) => [c[1], c[2]])).toEqual([['a', 'schedule'], ['b', 'schedule'], ['c', 'schedule']])
    expect(out).toEqual({ processed: 3, skipped: 0, results: [{ userId: 'a', errors: 0 }, { userId: 'b', errors: -1 }, { userId: 'c', errors: 1 }] })
  })
  it('skips users whose interval has not elapsed', async () => {
    const deps = makeDeps(['a', 'b'], { b: { active: true, pollIntervalMinutes: 120, lastPolledAt: '2026-09-21T09:50:00.000Z' } })
    const run = vi.fn().mockResolvedValue({ errors: [] })
    const out = await createPollerHandler(deps, run as never)({ trigger: 'schedule' })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]![1]).toBe('a')
    expect(out.skipped).toBe(1)
  })
  it('manual trigger runs the given user regardless of interval', async () => {
    const deps = makeDeps(['a', 'b'], { z: { active: true, pollIntervalMinutes: 1440, lastPolledAt: nowIso } })
    const run = vi.fn().mockResolvedValue({ errors: [] })
    const out = await createPollerHandler(deps, run as never)({ trigger: 'manual', userId: 'z' })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]![1]).toBe('z')
    expect(out.processed).toBe(1)
  })
})
