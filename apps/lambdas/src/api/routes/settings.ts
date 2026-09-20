import { Hono } from 'hono'
import { z } from 'zod'
import { defaultSettings, SettingsPatchSchema, type Settings } from '@gighunter/core/schema'
import { connectFreelancer, connectTelegramBot, disconnectFreelancer, disconnectTelegramBot, sendTelegramTest } from '@gighunter/core/services'
import type { ApiEnv } from '../auth'
import type { ApiDeps } from '../deps'

export type PublicSettings = Omit<Settings, 'telegram'> & { telegram: Omit<Settings['telegram'], 'webhookSecret'> }

export function maskSettings(s: Settings): PublicSettings {
  const { webhookSecret: _omit, ...telegram } = s.telegram
  return { ...s, telegram }
}

const TokenBody = z.object({ token: z.string().trim().min(10).max(500) })

export function settingsRoutes(deps: ApiDeps) {
  const r = new Hono<ApiEnv>()
  const load = async (sub: string) => (await deps.store.getSettings(sub)) ?? defaultSettings(deps.now().toISOString())

  r.get('/settings', async (c) => c.json(maskSettings(await load(c.get('user').sub))))

  r.patch('/settings', async (c) => {
    const sub = c.get('user').sub
    const patch = SettingsPatchSchema.parse(await c.req.json())
    const s = await load(sub)
    if (patch.active !== undefined) s.active = patch.active
    if (patch.notifyThreshold !== undefined) s.notifyThreshold = patch.notifyThreshold
    if (patch.maxJobAgeHours !== undefined) s.maxJobAgeHours = patch.maxJobAgeHours
    if (patch.model !== undefined) s.model = patch.model
    if (patch.chatModel !== undefined) s.chatModel = patch.chatModel
    if (patch.platforms?.freelancer) s.platforms.freelancer = { ...s.platforms.freelancer, ...patch.platforms.freelancer }
    if (patch.telegram?.chatId !== undefined) s.telegram = { ...s.telegram, chatId: patch.telegram.chatId, chatTitle: 'set manually' }
    s.updatedAt = deps.now().toISOString()
    await deps.store.putSettings(sub, s)
    return c.json(maskSettings(s))
  })

  r.put('/settings/telegram/token', async (c) => {
    const { token } = TokenBody.parse(await c.req.json())
    return c.json(maskSettings(await connectTelegramBot(deps, c.get('user').sub, token)))
  })
  r.delete('/settings/telegram/token', async (c) => c.json(maskSettings(await disconnectTelegramBot(deps, c.get('user').sub))))
  r.post('/settings/telegram/test', async (c) => {
    await sendTelegramTest(deps, c.get('user').sub)
    return c.body(null, 204)
  })

  r.put('/settings/freelancer/token', async (c) => {
    const { token } = TokenBody.parse(await c.req.json())
    return c.json(maskSettings(await connectFreelancer(deps, c.get('user').sub, token)))
  })
  r.delete('/settings/freelancer/token', async (c) => c.json(maskSettings(await disconnectFreelancer(deps, c.get('user').sub))))

  return r
}
