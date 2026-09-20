import type { MiddlewareHandler } from 'hono'
import type { LambdaEvent } from 'hono/aws-lambda'

export interface AuthUser { sub: string; email: string }
export type ApiEnv = { Bindings: { event: LambdaEvent }; Variables: { user: AuthUser } }

/** Reads Cognito claims injected by the API Gateway JWT authorizer. Never trust anything else for identity. */
export function claimsFrom(event: unknown): AuthUser | null {
  const claims = (event as { requestContext?: { authorizer?: { jwt?: { claims?: Record<string, unknown> } } } })?.requestContext?.authorizer?.jwt?.claims
  const sub = claims?.sub
  if (typeof sub !== 'string' || !sub) return null
  return { sub, email: typeof claims?.email === 'string' ? claims.email : '' }
}

export const requireAuth: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const user = claimsFrom(c.env?.event)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  c.set('user', user)
  await next()
}
