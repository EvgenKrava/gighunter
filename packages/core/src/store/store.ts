import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { BatchGetCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import {
  ChatSchema, MatchSchema, ProfileSchema, PromptsSchema, RunSchema, SettingsSchema,
  type Chat, type Feedback, type Match, type MatchRef, type MatchStatus, type Profile, type Prompts, type Run, type Settings,
} from '../schema/index'
import { ACTIVE_USER_GSI1PK, GSI1, GSI2, SK, chatSk, matchGsi2pk, matchSk, runSk, userPk } from './keys'

type Item = Record<string, unknown>
const INTERNAL_KEYS = ['pk', 'sk', 'gsi1pk', 'gsi1sk', 'gsi2pk', 'gsi2sk'] as const

function strip(item: Item): Item {
  const out: Item = { ...item }
  for (const k of INTERNAL_KEYS) delete out[k]
  return out
}
const encodeCursor = (key: Item | undefined) => (key ? Buffer.from(JSON.stringify(key)).toString('base64url') : undefined)
const decodeCursor = (cursor: string | undefined): Item | undefined =>
  cursor ? (JSON.parse(Buffer.from(cursor, 'base64url').toString()) as Item) : undefined

export interface MatchPage { items: Match[]; cursor?: string }
export interface MatchStatusPatch { status: MatchStatus; telegramMessageId?: number; notifiedAt?: string }

export class Store {
  constructor(private readonly doc: DynamoDBDocumentClient, private readonly tableName: string) {}

  private async getItem(pk: string, sk: string): Promise<Item | null> {
    const r = await this.doc.send(new GetCommand({ TableName: this.tableName, Key: { pk, sk } }))
    return r.Item ? strip(r.Item) : null
  }
  private async putItem(item: Item): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.tableName, Item: item }))
  }

  // --- profile / settings / prompts -------------------------------------------------
  async getProfile(userId: string): Promise<Profile | null> {
    const i = await this.getItem(userPk(userId), SK.profile)
    return i ? ProfileSchema.parse(i) : null
  }
  async putProfile(userId: string, profile: Profile): Promise<void> {
    await this.putItem({ pk: userPk(userId), sk: SK.profile, ...profile })
  }
  async getSettings(userId: string): Promise<Settings | null> {
    const i = await this.getItem(userPk(userId), SK.settings)
    return i ? SettingsSchema.parse(i) : null
  }
  async putSettings(userId: string, settings: Settings): Promise<void> {
    const gsi = settings.active ? { gsi1pk: ACTIVE_USER_GSI1PK, gsi1sk: userId } : {}
    await this.putItem({ pk: userPk(userId), sk: SK.settings, ...gsi, ...settings })
  }
  /** Stamps lastPolledAt without rewriting the whole SETTINGS item (the API may be editing it concurrently). */
  async touchLastPolled(userId: string, at: string): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: userPk(userId), sk: SK.settings },
        UpdateExpression: 'SET lastPolledAt = :at',
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeValues: { ':at': at },
      }),
    )
  }
  async getPrompts(userId: string): Promise<Prompts | null> {
    const i = await this.getItem(userPk(userId), SK.prompts)
    return i ? PromptsSchema.parse(i) : null
  }
  async putPrompts(userId: string, prompts: Prompts): Promise<void> {
    await this.putItem({ pk: userPk(userId), sk: SK.prompts, ...prompts })
  }

  // --- users ------------------------------------------------------------------------
  async listActiveUsers(): Promise<string[]> {
    const users: string[] = []
    let ExclusiveStartKey: Item | undefined
    do {
      const r = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: GSI1,
          KeyConditionExpression: 'gsi1pk = :p',
          ExpressionAttributeValues: { ':p': ACTIVE_USER_GSI1PK },
          ProjectionExpression: 'gsi1sk',
          ExclusiveStartKey,
        }),
      )
      for (const i of r.Items ?? []) users.push(String(i.gsi1sk))
      ExclusiveStartKey = r.LastEvaluatedKey
    } while (ExclusiveStartKey)
    return users
  }

  // --- matches ----------------------------------------------------------------------
  async getMatch(userId: string, ref: MatchRef): Promise<Match | null> {
    const i = await this.getItem(userPk(userId), matchSk(ref))
    return i ? MatchSchema.parse(i) : null
  }

  /** Returns the subset of refs that already exist, as `platform#externalId` strings. */
  async existingMatchKeys(userId: string, refs: MatchRef[]): Promise<Set<string>> {
    const found = new Set<string>()
    for (let i = 0; i < refs.length; i += 100) {
      let keys: Item[] = refs.slice(i, i + 100).map((ref) => ({ pk: userPk(userId), sk: matchSk(ref) }))
      while (keys.length) {
        const r = await this.doc.send(
          new BatchGetCommand({ RequestItems: { [this.tableName]: { Keys: keys, ProjectionExpression: 'sk' } } }),
        )
        for (const item of r.Responses?.[this.tableName] ?? []) found.add(String(item.sk).slice('MATCH#'.length))
        keys = (r.UnprocessedKeys?.[this.tableName]?.Keys as Item[] | undefined) ?? []
      }
    }
    return found
  }

  async putMatch(userId: string, match: Match): Promise<void> {
    const ref = { platform: match.job.platform, externalId: match.job.externalId }
    await this.putItem({ pk: userPk(userId), sk: matchSk(ref), gsi2pk: matchGsi2pk(userId, match.status), gsi2sk: match.job.postedAt, ...match })
  }

  async updateMatchStatus(userId: string, ref: MatchRef, patch: MatchStatusPatch): Promise<void> {
    const sets = ['#status = :status', 'gsi2pk = :gsi2pk']
    const values: Item = { ':status': patch.status, ':gsi2pk': matchGsi2pk(userId, patch.status) }
    if (patch.telegramMessageId !== undefined) {
      sets.push('telegramMessageId = :telegramMessageId')
      values[':telegramMessageId'] = patch.telegramMessageId
    }
    if (patch.notifiedAt !== undefined) {
      sets.push('notifiedAt = :notifiedAt')
      values[':notifiedAt'] = patch.notifiedAt
    }
    await this.doc.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: userPk(userId), sk: matchSk(ref) },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: values,
      }),
    )
  }

  async setMatchFeedback(userId: string, ref: MatchRef, feedback: Feedback, at: string): Promise<Match | null> {
    try {
      const r = await this.doc.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: userPk(userId), sk: matchSk(ref) },
          UpdateExpression: 'SET feedback = :f, feedbackAt = :at',
          ConditionExpression: 'attribute_exists(pk)',
          ExpressionAttributeValues: { ':f': feedback, ':at': at },
          ReturnValues: 'ALL_NEW',
        }),
      )
      return r.Attributes ? MatchSchema.parse(strip(r.Attributes)) : null
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) return null
      throw e
    }
  }

  async listMatches(userId: string, status: MatchStatus, opts: { limit?: number; cursor?: string } = {}): Promise<MatchPage> {
    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: GSI2,
        KeyConditionExpression: 'gsi2pk = :p',
        ExpressionAttributeValues: { ':p': matchGsi2pk(userId, status) },
        ScanIndexForward: false,
        Limit: opts.limit ?? 50,
        ExclusiveStartKey: decodeCursor(opts.cursor),
      }),
    )
    return { items: (r.Items ?? []).map((i) => MatchSchema.parse(strip(i))), cursor: encodeCursor(r.LastEvaluatedKey) }
  }

  // --- runs -------------------------------------------------------------------------
  async putRun(userId: string, run: Run): Promise<void> {
    await this.putItem({ pk: userPk(userId), sk: runSk(run.startedAt), ...run })
  }
  async listRuns(userId: string, limit = 10): Promise<Run[]> {
    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': userPk(userId), ':prefix': 'RUN#' },
        ScanIndexForward: false,
        Limit: limit,
      }),
    )
    return (r.Items ?? []).map((i) => RunSchema.parse(strip(i)))
  }

  // --- chat -------------------------------------------------------------------------
  async getChat(userId: string, ref: MatchRef): Promise<Chat | null> {
    const i = await this.getItem(userPk(userId), chatSk(ref))
    return i ? ChatSchema.parse(i) : null
  }
  async putChat(userId: string, ref: MatchRef, chat: Chat): Promise<void> {
    await this.putItem({ pk: userPk(userId), sk: chatSk(ref), ...chat })
  }
  async deleteChat(userId: string, ref: MatchRef): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.tableName, Key: { pk: userPk(userId), sk: chatSk(ref) } }))
  }
}
