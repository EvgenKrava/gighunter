import type { JobSource } from '../adapters/index'
import { defaultSettings, type Platform, type Settings } from '../schema/index'
import type { Secrets } from '../secrets/index'
import type { Store } from '../store/index'
import { ServiceError } from './errors'

export interface FreelancerSetupDeps {
  store: Store
  secrets: Secrets
  sources: Record<Platform, JobSource>
  now: () => Date
}

export async function connectFreelancer(deps: FreelancerSetupDeps, userId: string, token: string): Promise<Settings> {
  const verified = await deps.sources.freelancer.verifyToken(token)
  if (!verified.ok) throw new ServiceError(`Freelancer.com rejected the token (${verified.error})`, 400, 'invalid_token')
  await deps.secrets.putUserSecret(userId, 'freelancer/token', token)
  const settings = (await deps.store.getSettings(userId)) ?? defaultSettings(deps.now().toISOString())
  settings.platforms.freelancer = { ...settings.platforms.freelancer, tokenSet: true, tokenHint: token.slice(-4), connectedAs: verified.username }
  settings.updatedAt = deps.now().toISOString()
  await deps.store.putSettings(userId, settings)
  return settings
}

export async function disconnectFreelancer(deps: FreelancerSetupDeps, userId: string): Promise<Settings> {
  await deps.secrets.deleteUserSecret(userId, 'freelancer/token')
  const settings = (await deps.store.getSettings(userId)) ?? defaultSettings(deps.now().toISOString())
  settings.platforms.freelancer = { enabled: false, query: settings.platforms.freelancer.query, tokenSet: false }
  settings.updatedAt = deps.now().toISOString()
  await deps.store.putSettings(userId, settings)
  return settings
}
