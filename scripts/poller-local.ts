import { parseArgs } from 'node:util'
import { buildCoreDeps, env } from '@gighunter/lambdas/deps'
import { runForUser, type PipelineDeps } from '@gighunter/core/pipeline'
import type { Store } from '@gighunter/core/store'

const { values } = parseArgs({
  options: { user: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, trigger: { type: 'string', default: 'manual' } },
})
if (!values.user) throw new Error('usage: pnpm poller:local --user <sub> [--dry-run]')

const deps: PipelineDeps = { ...buildCoreDeps('poller-local'), appUrl: env('APP_URL') }

if (values['dry-run']) {
  const WRITE = /^(put|update|delete|set)/
  deps.store = new Proxy(deps.store, {
    get(target, prop) {
      const value = Reflect.get(target, prop)
      if (typeof value === 'function' && typeof prop === 'string' && WRITE.test(prop)) {
        return async (...args: unknown[]) => {
          console.log(`[dry-run] store.${prop}`, JSON.stringify(args[1] ?? args[0]).slice(0, 200))
          return prop === 'setMatchFeedback' ? null : undefined
        }
      }
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as Store
  deps.createTelegram = () =>
    ({
      sendMessage: async (chatId: string, text: string) => {
        console.log(`[dry-run] telegram → ${chatId}\n${text}\n`)
        return { messageId: 0 }
      },
    }) as never
}

const run = await runForUser(deps, values.user, values.trigger as 'manual' | 'schedule')
console.log(JSON.stringify(run, null, 2))
