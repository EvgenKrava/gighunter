import AnthropicBedrock, { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk'
import type Anthropic from '@anthropic-ai/sdk'
import type { Usage } from '../schema/index'

export type CreateParams = Anthropic.MessageCreateParamsNonStreaming

export interface ParsedResponse<T> {
  parsed_output: T | null
  usage: Anthropic.Usage
  stop_reason: string | null
}

/** The slice of the Anthropic client surface this codebase uses; both Bedrock clients satisfy it at runtime. */
export interface LlmClient {
  messages: {
    create(params: CreateParams): Promise<Anthropic.Message>
    parse<T>(params: Record<string, unknown>): Promise<ParsedResponse<T>>
  }
}

// Models served by the Messages-API Bedrock endpoint (Mantle). Everything else is the legacy InvokeModel stack.
const MANTLE_PATTERNS = [/claude-opus-4-7/, /claude-opus-4-8/, /claude-opus-5/, /claude-sonnet-5/, /claude-fable/, /claude-mythos/]

export function usesMantle(modelId: string): boolean {
  return MANTLE_PATTERNS.some((re) => re.test(modelId))
}

/** Adaptive thinking exists from the 4.6 generation on; Haiku 4.5 / Sonnet 4.5 / Opus 4.5 do not take it. */
export function supportsAdaptiveThinking(modelId: string): boolean {
  return usesMantle(modelId) || /claude-(opus|sonnet)-4-6/.test(modelId)
}

export function createBedrockClient(modelId: string, region = process.env.AWS_REGION ?? 'us-east-1'): LlmClient {
  // A null apiKey forces SigV4 (IAM) auth even when AWS_BEARER_TOKEN_BEDROCK / ANTHROPIC_AUTH_TOKEN are set in the
  // environment (developer shells often have them); GigHunter authenticates with the Lambda role, never a bearer token.
  // The SDK's ClientOptions type only admits `string | undefined`, but `undefined` re-enables the env lookup, so the
  // runtime-honoured `null` is passed through a cast.
  const noBearer = { awsRegion: region, apiKey: null as unknown as string }
  const client = usesMantle(modelId) ? new AnthropicBedrockMantle(noBearer) : new AnthropicBedrock(noBearer)
  return client as unknown as LlmClient
}

export function usageFrom(u: Anthropic.Usage): Usage {
  return {
    inputTokens: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    outputTokens: u.output_tokens,
  }
}
