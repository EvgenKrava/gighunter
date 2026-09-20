import { SSMClient } from '@aws-sdk/client-ssm'
import { createLogger } from '@gighunter/core/logger'
import { Secrets } from '@gighunter/core/secrets'
import { createPreSignupHandler } from './handler'

const region = process.env.AWS_REGION ?? 'us-east-1'
export const handler = createPreSignupHandler({
  secrets: new Secrets(new SSMClient({ region }), process.env.SSM_PREFIX ?? '/gighunter'),
  log: createLogger({ fn: 'pre-signup' }),
})
