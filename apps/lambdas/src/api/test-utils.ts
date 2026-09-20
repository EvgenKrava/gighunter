import { vi } from 'vitest'
import { createLogger } from '@gighunter/core/logger'
import type { ApiDeps } from './deps'

export function makeApiDeps(overrides: Partial<Record<keyof ApiDeps, unknown>> & { store?: Record<string, unknown> } = {}): ApiDeps {
  const store = {
    getProfile: vi.fn().mockResolvedValue(null), putProfile: vi.fn(),
    getSettings: vi.fn().mockResolvedValue(null), putSettings: vi.fn(),
    getPrompts: vi.fn().mockResolvedValue(null), putPrompts: vi.fn(),
    getMatch: vi.fn().mockResolvedValue(null), listMatches: vi.fn().mockResolvedValue({ items: [] }), setMatchFeedback: vi.fn().mockResolvedValue(null),
    getChat: vi.fn().mockResolvedValue(null), putChat: vi.fn(), deleteChat: vi.fn(),
    listRuns: vi.fn().mockResolvedValue([]), putRun: vi.fn(), listActiveUsers: vi.fn().mockResolvedValue([]), existingMatchKeys: vi.fn(), putMatch: vi.fn(), updateMatchStatus: vi.fn(),
    ...(overrides.store ?? {}),
  }
  const { store: _s, ...rest } = overrides
  return {
    store: store as never,
    secrets: { getUserSecret: vi.fn().mockResolvedValue(null), putUserSecret: vi.fn(), deleteUserSecret: vi.fn(), getAllowedEmails: vi.fn(), userParamName: vi.fn() } as never,
    sources: { freelancer: { platform: 'freelancer', fetchRecent: vi.fn(), verifyToken: vi.fn() }, upwork: { platform: 'upwork', fetchRecent: vi.fn(), verifyToken: vi.fn() } } as never,
    createLlm: vi.fn(),
    createTelegram: vi.fn(),
    now: () => new Date('2026-09-20T10:00:00.000Z'),
    log: createLogger({}, () => {}),
    apiBaseUrl: 'https://api.test',
    invokePoller: vi.fn().mockResolvedValue(undefined),
    ...(rest as Partial<ApiDeps>),
  }
}

export const authed = (sub = 'u1', email = 'me@example.com') => ({ event: { requestContext: { authorizer: { jwt: { claims: { sub, email } } } } } })
export const anonymous = () => ({ event: { requestContext: {} } })
export const json = (body: unknown, method = 'POST') => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

/** Response.json() is typed `unknown` by lib.dom in TS 5.9+; tests assert on shape, so `any` is the honest type here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const body = (res: Response): Promise<any> => res.json()
