import type { FetchFn } from '../notifier/index'
import type { Platform, Settings } from '../schema/index'
import { FreelancerSource } from './freelancer/source'
import { UpworkSource } from './upwork/source'
import type { JobSource } from './types'

export * from './types'
export { FreelancerSource } from './freelancer/source'
export { normalizeFreelancerProject } from './freelancer/normalize'
export { UpworkSource } from './upwork/source'

export function createSources(fetchFn: FetchFn = fetch): Record<Platform, JobSource> {
  return { freelancer: new FreelancerSource(fetchFn), upwork: new UpworkSource() }
}

export function enabledPlatforms(settings: Settings): Platform[] {
  const out: Platform[] = []
  const f = settings.platforms.freelancer
  if (f.enabled && f.tokenSet) out.push('freelancer')
  return out
}
