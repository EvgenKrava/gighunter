import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { buildCoreDeps } from '@gighunter/lambdas/deps'
import { ProfileInputSchema, SettingsPatchSchema, defaultSettings } from '@gighunter/core/schema'
import { connectFreelancer, connectTelegramBot } from '@gighunter/core/services'

const SeedFile = z.object({
  sub: z.string().min(1),
  profile: ProfileInputSchema,
  settings: SettingsPatchSchema.optional(),
  secrets: z.object({ telegramBotToken: z.string().optional(), freelancerToken: z.string().optional() }).optional(),
})

const { values } = parseArgs({ options: { file: { type: 'string' }, 'api-url': { type: 'string' } } })
if (!values.file) throw new Error('usage: pnpm seed:user --file seed.local.json --api-url https://<api-id>.execute-api.us-east-1.amazonaws.com')
const seed = SeedFile.parse(JSON.parse(readFileSync(values.file, 'utf8')))

const deps = buildCoreDeps('seed')
const nowIso = deps.now().toISOString()

await deps.store.putProfile(seed.sub, { ...seed.profile, updatedAt: nowIso })
console.log('profile saved')

const settings = (await deps.store.getSettings(seed.sub)) ?? defaultSettings(nowIso)
const p = seed.settings ?? {}
if (p.active !== undefined) settings.active = p.active
if (p.notifyThreshold !== undefined) settings.notifyThreshold = p.notifyThreshold
if (p.maxJobAgeHours !== undefined) settings.maxJobAgeHours = p.maxJobAgeHours
if (p.model !== undefined) settings.model = p.model
if (p.chatModel !== undefined) settings.chatModel = p.chatModel
if (p.platforms?.freelancer) settings.platforms.freelancer = { ...settings.platforms.freelancer, ...p.platforms.freelancer }
if (p.telegram?.chatId !== undefined) settings.telegram = { ...settings.telegram, chatId: p.telegram.chatId, chatTitle: 'seeded' }
settings.updatedAt = nowIso
await deps.store.putSettings(seed.sub, settings)
console.log('settings saved')

if (seed.secrets?.telegramBotToken) {
  if (!values['api-url']) throw new Error('--api-url is required to register the Telegram webhook')
  const s = await connectTelegramBot({ ...deps, apiBaseUrl: values['api-url'] }, seed.sub, seed.secrets.telegramBotToken)
  console.log(`telegram connected as @${s.telegram.botUsername}; now send /start to the bot (or add it to a channel as admin)`)
}
if (seed.secrets?.freelancerToken) {
  const s = await connectFreelancer(deps, seed.sub, seed.secrets.freelancerToken)
  console.log(`freelancer connected as ${s.platforms.freelancer.connectedAs}`)
}
console.log('done')
