import { runForUser, type PipelineDeps } from '@gighunter/core/pipeline'

export interface PollerEvent { trigger?: 'schedule' | 'manual'; userId?: string }
export interface PollerResult { processed: number; skipped: number; results: { userId: string; errors: number }[] }

/** A scheduled tick runs a user only when their poll interval has elapsed; manual runs always go. */
export function isDue(settings: { active: boolean; pollIntervalMinutes: number; lastPolledAt?: string } | null, now: Date): boolean {
  if (!settings?.active) return false
  if (!settings.lastPolledAt) return true
  return now.getTime() - new Date(settings.lastPolledAt).getTime() >= settings.pollIntervalMinutes * 60_000 - 30_000 // 30 s slack for scheduler jitter
}

export function createPollerHandler(deps: PipelineDeps, run: typeof runForUser = runForUser) {
  return async (event: PollerEvent): Promise<PollerResult> => {
    const trigger = event.trigger ?? 'schedule'
    const users = event.userId ? [event.userId] : await deps.store.listActiveUsers()
    deps.log.info('poller.start', { trigger, users: users.length })
    const results: PollerResult['results'] = []
    let skipped = 0
    for (const userId of users) {
      try {
        if (trigger === 'schedule' && !isDue(await deps.store.getSettings(userId), deps.now())) {
          skipped++
          continue
        }
        const r = await run(deps, userId, trigger)
        results.push({ userId, errors: r.errors.length })
      } catch (e) {
        deps.log.error('poller.user_failed', { userId, err: e })
        results.push({ userId, errors: -1 })
      }
    }
    if (skipped) deps.log.info('poller.skipped', { skipped })
    return { processed: results.length, skipped, results }
  }
}
