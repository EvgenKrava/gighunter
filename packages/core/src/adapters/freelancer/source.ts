import type { Job } from '../../schema/index'
import type { FetchFn } from '../../notifier/index'
import { SourceError, type FetchRecentParams, type JobSource, type VerifyResult } from '../types'
import { normalizeFreelancerProject, type FreelancerProject, type FreelancerUser } from './normalize'

interface ActiveProjectsResponse {
  status: string
  result?: { projects?: FreelancerProject[]; users?: Record<string, FreelancerUser> }
}

export class FreelancerSource implements JobSource {
  readonly platform = 'freelancer' as const

  constructor(
    private readonly fetchFn: FetchFn = fetch,
    private readonly baseUrl = 'https://www.freelancer.com/api',
  ) {}

  private async request<T>(path: string, token: string): Promise<T> {
    let res: Response
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, { headers: { 'freelancer-oauth-v1': token, accept: 'application/json' } })
    } catch (e) {
      throw new SourceError(`freelancer: network error: ${(e as Error).message}`, 'network')
    }
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') ?? '60')
      throw new SourceError('freelancer: rate limited', 'rate_limited', Number.isFinite(retry) ? retry : 60)
    }
    if (!res.ok) throw new SourceError(`freelancer: HTTP ${res.status}`, `http_${res.status}`)
    return (await res.json()) as T
  }

  async fetchRecent({ query, since, token }: FetchRecentParams): Promise<Job[]> {
    const params = new URLSearchParams({
      query,
      limit: '50',
      compact: 'true',
      job_details: 'true',
      user_details: 'true',
      full_description: 'true',
      sort_field: 'time_updated',
      from_time: String(Math.floor(since.getTime() / 1000)),
    })
    const body = await this.request<ActiveProjectsResponse>(`/projects/0.1/projects/active/?${params}`, token)
    const users = body.result?.users ?? {}
    return (body.result?.projects ?? []).map((p) => normalizeFreelancerProject(p, users))
  }

  async verifyToken(token: string): Promise<VerifyResult> {
    try {
      const body = await this.request<{ result?: { username?: string } }>('/users/0.1/self/', token)
      return body.result?.username ? { ok: true, username: body.result.username } : { ok: false, error: 'no_username' }
    } catch (e) {
      return { ok: false, error: e instanceof SourceError ? e.code : 'unknown' }
    }
  }
}
