import type { CoreDeps } from '../shared/deps'

export interface ApiDeps extends CoreDeps {
  apiBaseUrl: string
  invokePoller: (userId: string) => Promise<void>
  /** Deletes the Cognito user; resolves when the user is already gone. */
  deleteIdentity: (userId: string) => Promise<void>
}
