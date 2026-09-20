import { describe, it, expect, beforeEach } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { SSMClient, GetParameterCommand, PutParameterCommand, DeleteParameterCommand, ParameterNotFound } from '@aws-sdk/client-ssm'
import { Secrets } from './secrets'

// aws-sdk-client-mock 4.x types lag behind the current SDK; stub typed with the surface used here.
interface Stub {
  on(command: unknown): { resolves(r: unknown): Stub; resolvesOnce(r: unknown): ReturnType<Stub['on']>; rejectsOnce(e: unknown): ReturnType<Stub['on']> }
  commandCalls(command: unknown): { args: [{ input: Record<string, any> }] }[]
}
let ssm: Stub
const secrets = new Secrets(new SSMClient({}))
beforeEach(() => {
  ssm = mockClient(SSMClient as never) as unknown as Stub
})

describe('Secrets', () => {
  it('builds parameter names under the prefix', () => {
    expect(secrets.userParamName('u1', 'telegram/bot-token')).toBe('/gighunter/users/u1/telegram/bot-token')
  })
  it('getUserSecret decrypts and returns null when missing', async () => {
    ssm.on(GetParameterCommand).resolvesOnce({ Parameter: { Value: 'tok' } }).rejectsOnce(new ParameterNotFound({ message: 'nope', $metadata: {} }))
    expect(await secrets.getUserSecret('u1', 'freelancer/token')).toBe('tok')
    expect(ssm.commandCalls(GetParameterCommand)[0]!.args[0].input).toEqual({ Name: '/gighunter/users/u1/freelancer/token', WithDecryption: true })
    expect(await secrets.getUserSecret('u1', 'freelancer/token')).toBeNull()
  })
  it('putUserSecret writes a SecureString with overwrite', async () => {
    ssm.on(PutParameterCommand).resolves({})
    await secrets.putUserSecret('u1', 'telegram/bot-token', '123:abc')
    expect(ssm.commandCalls(PutParameterCommand)[0]!.args[0].input).toEqual({ Name: '/gighunter/users/u1/telegram/bot-token', Value: '123:abc', Type: 'SecureString', Overwrite: true })
  })
  it('deleteUserSecret ignores missing parameters', async () => {
    ssm.on(DeleteParameterCommand).rejectsOnce(new ParameterNotFound({ message: 'nope', $metadata: {} }))
    await expect(secrets.deleteUserSecret('u1', 'telegram/bot-token')).resolves.toBeUndefined()
  })
  it('getAllowedEmails splits, trims and lowercases', async () => {
    ssm.on(GetParameterCommand).resolvesOnce({ Parameter: { Value: ' A@x.com, b@y.com ,' } }).rejectsOnce(new ParameterNotFound({ message: 'nope', $metadata: {} }))
    expect(await secrets.getAllowedEmails()).toEqual(['a@x.com', 'b@y.com'])
    expect(await secrets.getAllowedEmails()).toEqual([])
  })
})
