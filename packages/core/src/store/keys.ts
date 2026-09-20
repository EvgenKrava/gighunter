import type { MatchRef, MatchStatus } from '../schema/index'

export const userPk = (userId: string) => `USER#${userId}`
export const SK = { profile: 'PROFILE', settings: 'SETTINGS', prompts: 'PROMPTS' } as const
export const matchKey = (ref: MatchRef) => `${ref.platform}#${ref.externalId}`
export const matchSk = (ref: MatchRef) => `MATCH#${matchKey(ref)}`
export const chatSk = (ref: MatchRef) => `CHAT#${matchKey(ref)}`
export const runSk = (startedAt: string) => `RUN#${startedAt}`
export const ACTIVE_USER_GSI1PK = 'ACTIVE_USER'
export const matchGsi2pk = (userId: string, status: MatchStatus) => `${userPk(userId)}#${status}`
export const GSI1 = 'gsi1'
export const GSI2 = 'gsi2'
export const ttlAfterDays = (iso: string, days: number) => Math.floor(new Date(iso).getTime() / 1000) + days * 86_400
export const MATCH_TTL_DAYS = 60
export const RUN_TTL_DAYS = 30
export const CHAT_TTL_DAYS = 60
