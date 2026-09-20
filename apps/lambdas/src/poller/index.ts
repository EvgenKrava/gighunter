import { buildCoreDeps, env } from '../shared/deps'
import { createPollerHandler } from './handler'

export const handler = createPollerHandler({ ...buildCoreDeps('poller'), appUrl: env('APP_URL') })
