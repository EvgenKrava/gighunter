import type { CoreDeps } from '../shared/deps'

export interface ApiDeps extends CoreDeps {
  apiBaseUrl: string
  invokePoller: (userId: string) => Promise<void>
}
