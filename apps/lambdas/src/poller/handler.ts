import { runForUser, type PipelineDeps } from '@gighunter/core/pipeline'

export interface PollerEvent { trigger?: 'schedule' | 'manual'; userId?: string }
export interface PollerResult { processed: number; results: { userId: string; errors: number }[] }

export function createPollerHandler(deps: PipelineDeps, run: typeof runForUser = runForUser) {
  return async (event: PollerEvent): Promise<PollerResult> => {
    const trigger = event.trigger ?? 'schedule'
    const users = event.userId ? [event.userId] : await deps.store.listActiveUsers()
    deps.log.info('poller.start', { trigger, users: users.length })
    const results: PollerResult['results'] = []
    for (const userId of users) {
      try {
        const r = await run(deps, userId, trigger)
        results.push({ userId, errors: r.errors.length })
      } catch (e) {
        deps.log.error('poller.user_failed', { userId, err: e })
        results.push({ userId, errors: -1 })
      }
    }
    return { processed: results.length, results }
  }
}
