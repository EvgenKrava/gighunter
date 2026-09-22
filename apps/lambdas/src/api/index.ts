import { AdminDeleteUserCommand, CognitoIdentityProviderClient, ListUsersCommand, UserNotFoundException } from '@aws-sdk/client-cognito-identity-provider'
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import { handle } from 'hono/aws-lambda'
import { buildCoreDeps, env } from '../shared/deps'
import { createApp } from './app'
import type { ApiDeps } from './deps'

const core = buildCoreDeps('api')
const region = process.env.AWS_REGION ?? 'us-east-1'
const lambda = new LambdaClient({ region })
const cognito = new CognitoIdentityProviderClient({ region })

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
  // The JWT `sub` is not the Cognito username (a Google-federated user is `Google_<google-sub>`), and admin
  // calls only accept `sub` in place of the username for local users — so resolve the username first.
  deleteIdentity: async (userId) => {
    const pool = env('USER_POOL_ID')
    const { Users } = await cognito.send(new ListUsersCommand({ UserPoolId: pool, Filter: `sub = "${userId}"`, Limit: 1 }))
    const username = Users?.[0]?.Username
    if (!username) return
    try {
      await cognito.send(new AdminDeleteUserCommand({ UserPoolId: pool, Username: username }))
    } catch (e) {
      if (!(e instanceof UserNotFoundException)) throw e
    }
  },
}

export const handler = handle(createApp(deps))
