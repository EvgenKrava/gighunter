# Account menu, account deletion, Terms & Privacy

**Date:** 2026-09-22 · **Status:** approved in chat

## Goal

Give the web app the account plumbing a public product needs: Profile lives in the account menu, a user can
delete their account themselves, and Terms / Privacy pages exist and are linked from the app and the landing page.

## Decisions

- **No "change password".** Sign-in is Google-only (`supported_identity_providers = ["Google"]`; the app skips the
  Hosted UI). The Account page says "Signed in with Google" and links to Google's account security page.
- **Deletion is immediate and hard.** No grace period, no soft-delete flag. Contact for legal pages: `oldfromkb@gmail.com`.

## Web

- **Account menu** (`UserMenu`, both headers): email · Profile · Account · Sign out, then a `Terms · Privacy` line.
  Profile leaves the main nav; the mobile bottom bar becomes Jobs · Activity · Settings (`grid-cols-3`).
- **`/account`** (inside `_app`): "Signed in with Google as <email>" + *Manage Google account* link;
  **Danger zone** card with *Delete account* → `ConfirmDialog` (danger) → `DELETE /me`. On success: `auth.removeUser()`
  (local session only — the Cognito user is gone, so the hosted logout endpoint is pointless) and navigate to `/`.
  Errors surface as a toast; the button stays enabled so it can be retried.
- **`/terms`, `/privacy`**: public static pages (outside `_app`), plain prose components. Landing footer links them.
  Content is drafted from what the code actually does (see below) and is a draft for the owner to review.

## API: `DELETE /me`

New route in `apps/lambdas/src/api/routes/account.ts`, wired in `app.ts`. Logic lives in
`packages/core/src/services/accountDeletion.ts` (`deleteAccount(deps, userId)`), in this order so a half-failed
attempt can simply be retried by the still-existing Cognito user:

1. Telegram: if a bot token is stored, best-effort `deleteWebhook()` (errors ignored — the token may be revoked).
2. SSM: delete `telegram/bot-token` and `freelancer/token` (`Secrets.deleteUserSecret` already tolerates absence).
3. DynamoDB: `Store.deleteUser(userId)` — query `pk = USER#<id>` (keys only, paginated) and `BatchWrite` deletes in
   chunks of 25, retrying `UnprocessedItems`.
4. Cognito: `AdminDeleteUser` via a new `deleteIdentity(userId)` dep (`@aws-sdk/client-cognito-identity-provider`);
   `UserNotFoundException` is treated as success.

Response: `204`. Auth as every other route (JWT sub = the user being deleted; nobody can delete anyone else).

## Infra (Terraform, `infra/main`)

- API lambda env: `USER_POOL_ID = aws_cognito_user_pool.main.id`.
- API IAM: `cognito-idp:AdminDeleteUser` on the pool ARN; `dynamodb:BatchWriteItem` on the table.
- Owner runs `pnpm build && terraform apply` after merge.

## Terms / Privacy content (facts the pages state)

- Identity: Google sign-in through AWS Cognito; we store the Google `sub` and email.
- Stored per user: profile, settings, prompt overrides, matched jobs (60-day TTL), search runs (30-day), per-job
  chats (60-day); Telegram bot token and Freelancer token encrypted in AWS SSM Parameter Store.
- Processors: AWS (us-east-1: Cognito, Lambda, DynamoDB, SSM), Anthropic Claude via Amazon Bedrock (profile + job
  text + chat messages are sent for scoring/drafting), Telegram (notifications through the user's own bot),
  Freelancer.com (fetched with the user's own token).
- Deletion: self-serve on the Account page, immediate and irreversible.
- Beta, invite-only, provided as-is, no warranty; the user is responsible for the platform tokens they connect.

## Testing

- Core: `deleteAccount` order + tolerance (Telegram failure ignored, Cognito not-found ok); `Store.deleteUser`
  pagination and 25-item chunking with `UnprocessedItems` retry.
- API: `DELETE /me` → 204 and calls the service with the JWT sub; 401 anonymous.
- Web: menu contents; Account page confirm → `DELETE /me` → `removeUser` + navigate; Terms/Privacy render and are
  linked from the landing footer.
