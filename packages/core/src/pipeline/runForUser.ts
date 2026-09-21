import { enabledPlatforms, SourceError, type JobSource } from '../adapters/index'
import { preFilter } from '../filter/index'
import type { LlmClient } from '../llm/index'
import type { Logger } from '../logger'
import { formatMatchMessage, type TelegramClient } from '../notifier/index'
import { buildScoringSystemPrompt, resolvePrompts } from '../prompts/index'
import { emptyPlatformStats, type Match, type Platform, type Run, type Settings } from '../schema/index'
import type { Secrets, UserSecretName } from '../secrets/index'
import { MATCH_TTL_DAYS, RUN_TTL_DAYS, matchKey, ttlAfterDays, type Store } from '../store/index'
import { scoreJob } from '../scorer/index'

export interface PipelineDeps {
  store: Store
  secrets: Secrets
  sources: Record<Platform, JobSource>
  createLlm: (model: string) => LlmClient
  createTelegram: (token: string) => TelegramClient
  appUrl: string
  now: () => Date
  log: Logger
}

const PLATFORM_SECRET: Record<Platform, UserSecretName | null> = { freelancer: 'freelancer/token', upwork: null }
/** Cost guard: at most this many LLM scoring calls per platform per run. The rest is left unwritten and picked up next run. */
export const MAX_SCORED_PER_RUN = 20
const platformQuery = (settings: Settings, platform: Platform) => (platform === 'freelancer' ? settings.platforms.freelancer.query : '')
const refOf = (m: Match) => ({ platform: m.job.platform, externalId: m.job.externalId })
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function runForUser(deps: PipelineDeps, userId: string, trigger: Run['trigger']): Promise<Run> {
  const startedAt = deps.now().toISOString()
  const run: Run = { startedAt, trigger, perPlatform: {}, usage: { inputTokens: 0, outputTokens: 0 }, errors: [], ttl: ttlAfterDays(startedAt, RUN_TTL_DAYS) }
  const log = deps.log.child({ userId, startedAt })
  const stats = (platform: Platform) => (run.perPlatform[platform] ??= emptyPlatformStats())
  const finish = async () => {
    run.finishedAt = deps.now().toISOString()
    await deps.store.putRun(userId, run)
    log.info('run.finish', { errors: run.errors.length, usage: run.usage, perPlatform: run.perPlatform })
    return run
  }

  try {
    const [profile, settings, promptsOverride] = await Promise.all([
      deps.store.getProfile(userId),
      deps.store.getSettings(userId),
      deps.store.getPrompts(userId),
    ])
    if (!profile || !settings) {
      run.errors.push('profile_or_settings_missing')
      return await finish()
    }

    const botToken = settings.telegram.tokenSet ? await deps.secrets.getUserSecret(userId, 'telegram/bot-token') : null
    const chatId = settings.telegram.chatId
    if (!botToken || !chatId) {
      run.errors.push('telegram_not_configured')
      log.warn('run.skipped', { reason: 'telegram_not_configured' })
      return await finish()
    }
    const telegram = deps.createTelegram(botToken)

    const notify = async (match: Match): Promise<boolean> => {
      try {
        const { text, replyMarkup } = formatMatchMessage(match, deps.appUrl)
        const { messageId } = await telegram.sendMessage(chatId, text, replyMarkup)
        await deps.store.updateMatchStatus(userId, refOf(match), { status: 'notified', telegramMessageId: messageId, notifiedAt: deps.now().toISOString() })
        return true
      } catch (e) {
        run.errors.push(`notify:${errMsg(e)}`)
        log.warn('notify.failed', { externalId: match.job.externalId, err: e })
        return false
      }
    }

    // 1. Deliver anything that failed to send in earlier runs.
    const pending = await deps.store.listMatches(userId, 'pending', { limit: 50 })
    for (const m of pending.items) if (await notify(m)) stats(m.job.platform).notified++

    // 2. Fetch → dedup → filter → score → notify, per enabled platform.
    const prompts = resolvePrompts(promptsOverride)
    const systemPrompt = buildScoringSystemPrompt(prompts.scoring, profile)
    const llm = deps.createLlm(settings.model)
    const since = new Date(deps.now().getTime() - settings.maxJobAgeHours * 3_600_000)

    for (const platform of enabledPlatforms(settings)) {
      const s = stats(platform)
      try {
        const secretName = PLATFORM_SECRET[platform]
        const token = secretName ? await deps.secrets.getUserSecret(userId, secretName) : null
        if (!token) {
          s.error = 'token_missing'
          continue
        }

        const jobs = await deps.sources[platform].fetchRecent({ query: platformQuery(settings, platform), since, token })
        s.fetched = jobs.length
        const known = await deps.store.existingMatchKeys(userId, jobs)
        const fresh = jobs.filter((j) => !known.has(matchKey(j)))
        s.new = fresh.length

        let skipped = 0
        for (const job of fresh) {
          const nowIso = deps.now().toISOString()
          const ttl = ttlAfterDays(nowIso, MATCH_TTL_DAYS)
          const reason = preFilter(job, profile, settings, deps.now())
          if (reason) {
            await deps.store.putMatch(userId, { job, status: 'filtered', filterReason: reason, createdAt: nowIso, ttl })
            s.filtered++
            continue
          }
          if (s.scored >= MAX_SCORED_PER_RUN) {
            skipped++
            continue
          }
          let scored: Awaited<ReturnType<typeof scoreJob>>
          try {
            scored = await scoreJob({ client: llm, model: settings.model, systemPrompt, job })
          } catch (e) {
            run.errors.push(`score:${platform}:${job.externalId}:${errMsg(e)}`)
            log.warn('score.failed', { platform, externalId: job.externalId, err: e })
            continue
          }
          run.usage.inputTokens += scored.usage.inputTokens
          run.usage.outputTokens += scored.usage.outputTokens
          const status = scored.result.score >= settings.notifyThreshold ? 'pending' : 'scored'
          const match: Match = { job, status, score: scored.result, verdict: scored.verdict, createdAt: nowIso, scoredAt: nowIso, ttl }
          await deps.store.putMatch(userId, match)
          s.scored++
          if (status === 'pending' && (await notify(match))) s.notified++
        }
        if (skipped) {
          run.errors.push(`score_cap:${platform}:${skipped}_skipped`)
          log.warn('score.capped', { platform, skipped, cap: MAX_SCORED_PER_RUN })
        }
      } catch (e) {
        s.error = e instanceof SourceError ? e.code : errMsg(e)
        log.warn('adapter.failed', { platform, err: e })
      }
    }
  } catch (e) {
    run.errors.push(`fatal:${errMsg(e)}`)
    log.error('run.fatal', { err: e })
  }
  return finish()
}
