import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import { handle } from 'hono/aws-lambda'
import { buildCoreDeps, env } from '../shared/deps'
import { createApp } from './app'
import type { ApiDeps } from './deps'

const core = buildCoreDeps('api')
const lambda = new LambdaClient({ region: process.env.AWS_REGION ?? 'us-east-1' })

const deps: ApiDeps = {
  ...core,
  apiBaseUrl: env('API_BASE_URL'),
  invokePoller: async (userId) => {
    await lambda.send(
      new InvokeCommand({
        FunctionName: env('POLLER_FUNCTION_NAME'),
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ trigger: 'manual', userId })),
      }),
    )
  },
}

export const handler = handle(createApp(deps))
