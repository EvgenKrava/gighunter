import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { SSMClient } from '@aws-sdk/client-ssm'
import { createSources } from '@gighunter/core/adapters'
import { createBedrockClient } from '@gighunter/core/llm'
import { createLogger } from '@gighunter/core/logger'
import { TelegramClient } from '@gighunter/core/notifier'
import type { PipelineDeps } from '@gighunter/core/pipeline'
import { Secrets } from '@gighunter/core/secrets'
import { Store } from '@gighunter/core/store'

export type CoreDeps = Omit<PipelineDeps, 'appUrl'>

export function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required environment variable ${name}`)
  return v
}

export function buildCoreDeps(fn: string): CoreDeps {
  const region = process.env.AWS_REGION ?? 'us-east-1'
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } })
  return {
    store: new Store(doc, env('TABLE_NAME')),
    secrets: new Secrets(new SSMClient({ region }), process.env.SSM_PREFIX ?? '/gighunter'),
    sources: createSources(),
    createLlm: (model) => createBedrockClient(model, region),
    createTelegram: (token) => new TelegramClient(token),
    now: () => new Date(),
    log: createLogger({ fn }),
  }
}
