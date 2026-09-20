import type { PreSignUpTriggerHandler } from 'aws-lambda'
import type { Logger } from '@gighunter/core/logger'
import type { Secrets } from '@gighunter/core/secrets'

export function createPreSignupHandler(deps: { secrets: Pick<Secrets, 'getAllowedEmails'>; log: Logger }): PreSignUpTriggerHandler {
  return async (event) => {
    const email = (event.request.userAttributes.email ?? '').trim().toLowerCase()
    const allowed = await deps.secrets.getAllowedEmails()
    if (!email || !allowed.includes(email)) {
      deps.log.warn('signup.rejected', { email })
      throw new Error('Sign-up is by invitation only.')
    }
    event.response.autoConfirmUser = true
    event.response.autoVerifyEmail = true
    deps.log.info('signup.allowed', { email })
    return event
  }
}
