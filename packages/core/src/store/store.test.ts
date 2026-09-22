import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, BatchGetCommand, BatchWriteCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'
import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { Store } from './store'
import { defaultSettings } from '../schema/index'
import { SAMPLE_MATCH } from '../prompts/index'

// aws-sdk-client-mock 4.x types lag behind the current SDK's middleware generics; the runtime stub is fine,
// so the stub is typed with the small surface these tests use.
interface Stub {
  on(command: unknown): { resolves(r: unknown): Stub; resolvesOnce(r: unknown): ReturnType<Stub['on']>; rejectsOnce(e: unknown): ReturnType<Stub['on']> }
  commandCalls(command: unknown): { args: [{ input: Record<string, any> }] }[]
  restore(): void
}
let ddb: Stub
const store = new Store(DynamoDBDocumentClient.from(new DynamoDBClient({})), 'tbl')
const now = '2026-09-20T10:00:00.000Z'

beforeEach(() => {
  ddb = mockClient(DynamoDBDocumentClient as never) as unknown as Stub
})
afterEach(() => ddb.restore())

describe('settings + active users', () => {
  it('putSettings writes gsi1 keys only when active', async () => {
    ddb.on(PutCommand).resolves({})
    await store.putSettings('u1', { ...defaultSettings(now), active: true })
    expect(ddb.commandCalls(PutCommand)[0]!.args[0].input.Item).toMatchObject({ pk: 'USER#u1', sk: 'SETTINGS', gsi1pk: 'ACTIVE_USER', gsi1sk: 'u1', active: true })
    await store.putSettings('u2', defaultSettings(now))
    expect(ddb.commandCalls(PutCommand)[1]!.args[0].input.Item).not.toHaveProperty('gsi1pk')
  })
  it('getSettings strips internal keys and parses defaults', async () => {
    ddb.on(GetCommand).resolves({ Item: { pk: 'USER#u1', sk: 'SETTINGS', gsi1pk: 'ACTIVE_USER', active: true, updatedAt: now } })
    const s = await store.getSettings('u1')
    expect(s).not.toHaveProperty('pk')
    expect(s?.notifyThreshold).toBe(70)
    ddb.on(GetCommand).resolves({})
    expect(await store.getSettings('nobody')).toBeNull()
  })
  it('touchLastPolled updates only lastPolledAt on an existing item', async () => {
    ddb.on(UpdateCommand).resolves({})
    await store.touchLastPolled('u1', now)
    expect(ddb.commandCalls(UpdateCommand)[0]!.args[0].input).toMatchObject({
      Key: { pk: 'USER#u1', sk: 'SETTINGS' }, UpdateExpression: 'SET lastPolledAt = :at', ConditionExpression: 'attribute_exists(pk)', ExpressionAttributeValues: { ':at': now },
    })
  })
  it('listActiveUsers queries gsi1 and follows pagination', async () => {
    ddb.on(QueryCommand).resolvesOnce({ Items: [{ gsi1sk: 'a' }], LastEvaluatedKey: { x: 1 } }).resolvesOnce({ Items: [{ gsi1sk: 'b' }] })
    expect(await store.listActiveUsers()).toEqual(['a', 'b'])
    expect(ddb.commandCalls(QueryCommand)[0]!.args[0].input).toMatchObject({ IndexName: 'gsi1', ExpressionAttributeValues: { ':p': 'ACTIVE_USER' } })
  })
})

describe('matches', () => {
  it('putMatch sets gsi2 keys from status and postedAt', async () => {
    ddb.on(PutCommand).resolves({})
    await store.putMatch('u1', SAMPLE_MATCH)
    expect(ddb.commandCalls(PutCommand)[0]!.args[0].input.Item).toMatchObject({
      pk: 'USER#u1', sk: 'MATCH#freelancer#sample-1', gsi2pk: 'USER#u1#notified', gsi2sk: SAMPLE_MATCH.job.postedAt, status: 'notified',
    })
  })
  it('existingMatchKeys batches by 100 and returns platform#id keys', async () => {
    const refs = Array.from({ length: 150 }, (_, i) => ({ platform: 'freelancer' as const, externalId: String(i) }))
    ddb.on(BatchGetCommand).resolvesOnce({ Responses: { tbl: [{ sk: 'MATCH#freelancer#3' }] } }).resolvesOnce({ Responses: { tbl: [{ sk: 'MATCH#freelancer#120' }] } })
    const keys = await store.existingMatchKeys('u1', refs)
    expect([...keys]).toEqual(['freelancer#3', 'freelancer#120'])
    expect(ddb.commandCalls(BatchGetCommand)).toHaveLength(2)
    expect(ddb.commandCalls(BatchGetCommand)[0]!.args[0].input.RequestItems!.tbl!.Keys).toHaveLength(100)
  })
  it('updateMatchStatus rewrites gsi2pk and optional delivery fields', async () => {
    ddb.on(UpdateCommand).resolves({})
    await store.updateMatchStatus('u1', { platform: 'freelancer', externalId: '1' }, { status: 'notified', telegramMessageId: 7, notifiedAt: now })
    const input = ddb.commandCalls(UpdateCommand)[0]!.args[0].input
    expect(input.UpdateExpression).toBe('SET #status = :status, gsi2pk = :gsi2pk, telegramMessageId = :telegramMessageId, notifiedAt = :notifiedAt')
    expect(input.ExpressionAttributeValues).toEqual({ ':status': 'notified', ':gsi2pk': 'USER#u1#notified', ':telegramMessageId': 7, ':notifiedAt': now })
  })
  it('setMatchFeedback returns the updated match or null when missing', async () => {
    ddb.on(UpdateCommand)
      .resolvesOnce({ Attributes: { pk: 'x', sk: 'y', ...SAMPLE_MATCH, feedback: 'up', feedbackAt: now } })
      .rejectsOnce(new ConditionalCheckFailedException({ message: 'no', $metadata: {} }))
    const m = await store.setMatchFeedback('u1', { platform: 'freelancer', externalId: 'sample-1' }, 'up', now)
    expect(m?.feedback).toBe('up')
    expect(await store.setMatchFeedback('u1', { platform: 'freelancer', externalId: 'zzz' }, 'up', now)).toBeNull()
  })
  it('listMatches queries gsi2 newest-first and round-trips the cursor', async () => {
    ddb.on(QueryCommand)
      .resolvesOnce({ Items: [{ pk: 'p', sk: 's', ...SAMPLE_MATCH }], LastEvaluatedKey: { pk: 'p', sk: 's', gsi2pk: 'g', gsi2sk: 't' } })
      .resolvesOnce({ Items: [] })
    const page = await store.listMatches('u1', 'notified', { limit: 1 })
    expect(page.items[0]!.job.externalId).toBe('sample-1')
    expect(page.cursor).toBeTruthy()
    const q = ddb.commandCalls(QueryCommand)[0]!.args[0].input
    expect(q).toMatchObject({ IndexName: 'gsi2', ScanIndexForward: false, Limit: 1, ExpressionAttributeValues: { ':p': 'USER#u1#notified' } })
    await store.listMatches('u1', 'notified', { cursor: page.cursor })
    expect(ddb.commandCalls(QueryCommand)[1]!.args[0].input.ExclusiveStartKey).toEqual({ pk: 'p', sk: 's', gsi2pk: 'g', gsi2sk: 't' })
  })
})

describe('runs + chat', () => {
  it('listRuns queries RUN# prefix descending', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] })
    await store.listRuns('u1', 5)
    expect(ddb.commandCalls(QueryCommand)[0]!.args[0].input).toMatchObject({
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': 'USER#u1', ':prefix': 'RUN#' }, ScanIndexForward: false, Limit: 5,
    })
  })
  it('deleteChat deletes by key', async () => {
    ddb.on(DeleteCommand).resolves({})
    await store.deleteChat('u1', { platform: 'freelancer', externalId: '1' })
    expect(ddb.commandCalls(DeleteCommand)[0]!.args[0].input.Key).toEqual({ pk: 'USER#u1', sk: 'CHAT#freelancer#1' })
  })
})

describe('deleteUser', () => {
  it('deletes every item under the user partition in batches of 25, following pagination and retrying unprocessed keys', async () => {
    const keys = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ pk: 'USER#u1', sk: `ITEM#${from + i}` }))
    ddb.on(QueryCommand)
      .resolvesOnce({ Items: keys(30), LastEvaluatedKey: { pk: 'USER#u1', sk: 'ITEM#29' } })
      .resolvesOnce({ Items: keys(2, 30) })
    ddb.on(BatchWriteCommand)
      .resolvesOnce({ UnprocessedItems: { tbl: [{ DeleteRequest: { Key: { pk: 'USER#u1', sk: 'ITEM#3' } } }] } })
      .resolves({})
    await store.deleteUser('u1')
    const q = ddb.commandCalls(QueryCommand)
    expect(q[0]!.args[0].input).toMatchObject({ KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': 'USER#u1' }, ProjectionExpression: 'pk, sk' })
    expect(q[1]!.args[0].input.ExclusiveStartKey).toEqual({ pk: 'USER#u1', sk: 'ITEM#29' })
    const batches = ddb.commandCalls(BatchWriteCommand).map((c) => c.args[0].input.RequestItems.tbl as { DeleteRequest: { Key: { sk: string } } }[])
    expect(batches.map((b) => b.length)).toEqual([25, 1, 5, 2])
    expect(batches[1]![0]!.DeleteRequest.Key.sk).toBe('ITEM#3')
    expect(batches.flat().map((r) => r.DeleteRequest.Key.sk).sort()).toEqual([...keys(32).map((k) => k.sk), 'ITEM#3'].sort())
  })
  it('is a no-op for an unknown user', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] })
    await store.deleteUser('nobody')
    expect(ddb.commandCalls(BatchWriteCommand)).toHaveLength(0)
  })
})
