import { DeleteParameterCommand, GetParameterCommand, ParameterNotFound, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm'

export type UserSecretName = 'telegram/bot-token' | 'freelancer/token'

export class Secrets {
  constructor(private readonly ssm: SSMClient, private readonly prefix = '/gighunter') {}

  userParamName(userId: string, name: UserSecretName): string {
    return `${this.prefix}/users/${userId}/${name}`
  }

  private async get(name: string): Promise<string | null> {
    try {
      const r = await this.ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }))
      return r.Parameter?.Value ?? null
    } catch (e) {
      if (e instanceof ParameterNotFound) return null
      throw e
    }
  }

  getUserSecret(userId: string, name: UserSecretName): Promise<string | null> {
    return this.get(this.userParamName(userId, name))
  }

  async putUserSecret(userId: string, name: UserSecretName, value: string): Promise<void> {
    await this.ssm.send(new PutParameterCommand({ Name: this.userParamName(userId, name), Value: value, Type: 'SecureString', Overwrite: true }))
  }

  async deleteUserSecret(userId: string, name: UserSecretName): Promise<void> {
    try {
      await this.ssm.send(new DeleteParameterCommand({ Name: this.userParamName(userId, name) }))
    } catch (e) {
      if (!(e instanceof ParameterNotFound)) throw e
    }
  }

  async getAllowedEmails(): Promise<string[]> {
    const raw = (await this.get(`${this.prefix}/auth/allowed-emails`)) ?? ''
    return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  }
}
