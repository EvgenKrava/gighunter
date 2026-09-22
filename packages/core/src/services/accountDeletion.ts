import type { TelegramClient } from '../notifier/index'
import type { Secrets } from '../secrets/index'
import type { Store } from '../store/index'

export interface AccountDeletionDeps {
  store: Pick<Store, 'deleteUser'>
  secrets: Pick<Secrets, 'getUserSecret' | 'deleteUserSecret'>
  createTelegram: (token: string) => Pick<TelegramClient, 'deleteWebhook'>
  /** Removes the sign-in identity (the Cognito user). Must succeed when the user is already gone. */
  deleteIdentity: (userId: string) => Promise<void>
}

/**
 * Hard-deletes everything we hold for a user. The identity goes last: if anything before it fails the
 * user still exists and can simply retry, whereas an orphaned identity could never clean up its data.
 */
export async function deleteAccount(deps: AccountDeletionDeps, userId: string): Promise<void> {
  const token = await deps.secrets.getUserSecret(userId, 'telegram/bot-token')
  if (token) {
    try {
      await deps.createTelegram(token).deleteWebhook()
    } catch {
      /* token may already be revoked; the bot simply stops reaching a webhook that no longer answers */
    }
  }
  await deps.secrets.deleteUserSecret(userId, 'telegram/bot-token')
  await deps.secrets.deleteUserSecret(userId, 'freelancer/token')
  await deps.store.deleteUser(userId)
  await deps.deleteIdentity(userId)
}
