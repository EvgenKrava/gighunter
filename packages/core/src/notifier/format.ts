import { approxUsd } from '../prompts/render'
import { FeedbackSchema, PlatformSchema, type Feedback, type Match, type MatchRef, type Platform } from '../schema/index'

export interface InlineKeyboard { inline_keyboard: { text: string; callback_data: string }[][] }

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const CALLBACK_MAX_BYTES = 64

export function feedbackCallbackData(ref: MatchRef, feedback: Feedback): string {
  const data = `fb:${ref.platform}:${ref.externalId}:${feedback}`
  if (Buffer.byteLength(data) > CALLBACK_MAX_BYTES) throw new Error(`callback_data exceeds ${CALLBACK_MAX_BYTES} bytes: ${data}`)
  return data
}

export function parseFeedbackCallbackData(data: string): { platform: Platform; externalId: string; feedback: Feedback } | null {
  const parts = data.split(':')
  if (parts.length !== 4 || parts[0] !== 'fb') return null
  const platform = PlatformSchema.safeParse(parts[1])
  const feedback = FeedbackSchema.safeParse(parts[3])
  if (!platform.success || !feedback.success || !parts[2]) return null
  return { platform: platform.data, externalId: parts[2], feedback: feedback.data }
}

export function feedbackKeyboard(ref: MatchRef): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: '👍 Useful', callback_data: feedbackCallbackData(ref, 'up') },
      { text: '👎 Not for me', callback_data: feedbackCallbackData(ref, 'down') },
    ]],
  }
}

export function feedbackChosenKeyboard(feedback: Feedback): InlineKeyboard {
  return { inline_keyboard: [[{ text: feedback === 'up' ? '✅ Marked useful' : '✅ Marked not for me', callback_data: 'noop' }]] }
}

const PLATFORM_LABEL: Record<Platform, string> = { freelancer: 'Freelancer', upwork: 'Upwork' }

function budgetLine(job: Match['job']): string {
  const b = job.budget
  if (!b) return 'budget n/a'
  const range =
    b.min !== undefined && b.max !== undefined ? `$${b.min}–${b.max}` : b.min !== undefined ? `from $${b.min}` : b.max !== undefined ? `up to $${b.max}` : '$?'
  return (b.type === 'hourly' ? `${range}/h ${b.currency} hourly` : `${range} ${b.currency} fixed`) + approxUsd(b)
}

const TELEGRAM_MAX = 4000

export function formatMatchMessage(match: Match, appUrl: string): { text: string; replyMarkup: InlineKeyboard } {
  const { job, score } = match
  const ref = { platform: job.platform, externalId: job.externalId }
  const head = `🎯 <b>${score?.score ?? '?'}/100</b> · ${escapeHtml(job.title)}`
  const meta = `💰 ${budgetLine(job)} · ⏱ ~${score?.estimatedHours ?? '?'}h · ${PLATFORM_LABEL[job.platform]}`
  const lines = [head, meta]
  if (score?.reasoning) lines.push(`<b>Why:</b> ${escapeHtml(score.reasoning)}`)
  if (score?.risks.length) lines.push(`<b>Risks:</b> ${escapeHtml(score.risks.join('; '))}`)
  lines.push(`🔗 <a href="${job.url}">Open job</a> · 💬 <a href="${appUrl}/jobs/${job.platform}/${encodeURIComponent(job.externalId)}">Chat in GigHunter</a>`)
  let text = lines.join('\n')
  if (text.length > TELEGRAM_MAX) text = text.slice(0, TELEGRAM_MAX - 1) + '…'
  return { text, replyMarkup: feedbackKeyboard(ref) }
}
