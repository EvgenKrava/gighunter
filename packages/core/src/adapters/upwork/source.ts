import type { Job } from '../../schema/index'
import type { FetchRecentParams, JobSource, VerifyResult } from '../types'

/** Placeholder until an Upwork API key is granted (spec §7). */
export class UpworkSource implements JobSource {
  readonly platform = 'upwork' as const
  async fetchRecent(_: FetchRecentParams): Promise<Job[]> {
    return []
  }
  async verifyToken(_: string): Promise<VerifyResult> {
    return { ok: false, error: 'not_implemented' }
  }
}
