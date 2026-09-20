import type { ErrorHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ZodError } from 'zod'
import type { Logger } from '@gighunter/core/logger'
import { TelegramError } from '@gighunter/core/notifier'
import { ServiceError } from '@gighunter/core/services'
import type { ApiEnv } from './auth'

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message)
    this.name = 'HttpError'
  }
}

export function errorHandler(log: Logger): ErrorHandler<ApiEnv> {
  return (err, c) => {
    if (err instanceof ZodError) return c.json({ error: 'validation_failed', issues: err.issues }, 400)
    if (err instanceof ServiceError) return c.json({ error: err.message, code: err.code }, err.status as ContentfulStatusCode)
    if (err instanceof HttpError) return c.json({ error: err.message, code: err.code }, err.status as ContentfulStatusCode)
    if (err instanceof TelegramError) return c.json({ error: err.message, code: 'telegram_error' }, 400)
    if (err instanceof SyntaxError) return c.json({ error: 'invalid JSON body' }, 400)
    log.error('api.unhandled', { err, path: c.req.path })
    return c.json({ error: 'internal error' }, 500)
  }
}
