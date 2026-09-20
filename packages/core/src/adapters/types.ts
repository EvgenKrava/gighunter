import type { Job, Platform } from '../schema/index'

export interface FetchRecentParams { query: string; since: Date; token: string }
export type VerifyResult = { ok: true; username: string } | { ok: false; error: string }

export interface JobSource {
  readonly platform: Platform
  fetchRecent(params: FetchRecentParams): Promise<Job[]>
  verifyToken(token: string): Promise<VerifyResult>
}

export class SourceError extends Error {
  constructor(message: string, readonly code: string, readonly retryAfterSec?: number) {
    super(message)
    this.name = 'SourceError'
  }
}
