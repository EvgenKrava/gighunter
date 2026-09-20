import { describe, it, expect } from 'vitest'
import { formatMatchMessage, feedbackCallbackData, parseFeedbackCallbackData, feedbackChosenKeyboard, escapeHtml } from './format'
import { SAMPLE_MATCH } from '../prompts/index'

describe('formatMatchMessage', () => {
  it('renders score, budget, hours, why, risks, links and buttons', () => {
    const { text, replyMarkup } = formatMatchMessage(SAMPLE_MATCH, 'https://gighunter.onlytools.click')
    expect(text).toContain('🎯 <b>82/100</b> · Fix Stripe webhook retries in a Next.js app')
    expect(text).toContain('💰 $150–300 USD fixed · ⏱ ~3h · Freelancer')
    expect(text).toContain('<b>Why:</b> Exact Next.js + Stripe match')
    expect(text).toContain('<b>Risks:</b> Repo state unknown; Client may expect ongoing support')
    expect(text).toContain('<a href="https://www.freelancer.com/projects/sample-1">Open job</a>')
    expect(text).toContain('<a href="https://gighunter.onlytools.click/jobs/freelancer/sample-1">Chat in GigHunter</a>')
    expect(replyMarkup.inline_keyboard[0]).toEqual([
      { text: '👍 Useful', callback_data: 'fb:freelancer:sample-1:up' },
      { text: '👎 Not for me', callback_data: 'fb:freelancer:sample-1:down' },
    ])
    expect(text).toMatchSnapshot()
  })
  it('escapes HTML in title and reasoning and omits the risks line when empty', () => {
    const m = { ...SAMPLE_MATCH, job: { ...SAMPLE_MATCH.job, title: 'a <b> & c' }, score: { ...SAMPLE_MATCH.score!, reasoning: '<x>', risks: [] } }
    const { text } = formatMatchMessage(m, 'https://app')
    expect(text).toContain('a &lt;b&gt; &amp; c')
    expect(text).toContain('<b>Why:</b> &lt;x&gt;')
    expect(text).not.toContain('Risks')
  })
  it('handles hourly and missing budgets', () => {
    const hourly = { ...SAMPLE_MATCH, job: { ...SAMPLE_MATCH.job, budget: { min: 20, max: 40, currency: 'USD', type: 'hourly' as const } } }
    expect(formatMatchMessage(hourly, 'x').text).toContain('💰 $20–40/h USD hourly')
    const none = { ...SAMPLE_MATCH, job: { ...SAMPLE_MATCH.job, budget: null } }
    expect(formatMatchMessage(none, 'x').text).toContain('💰 budget n/a')
  })
})

describe('callback data', () => {
  it('round-trips and stays ≤ 64 bytes', () => {
    const data = feedbackCallbackData({ platform: 'upwork', externalId: '~01abcdef1234567890' }, 'down')
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64)
    expect(parseFeedbackCallbackData(data)).toEqual({ platform: 'upwork', externalId: '~01abcdef1234567890', feedback: 'down' })
  })
  it('rejects garbage', () => {
    expect(parseFeedbackCallbackData('noop')).toBeNull()
    expect(parseFeedbackCallbackData('fb:nope:1:up')).toBeNull()
    expect(parseFeedbackCallbackData('fb:freelancer:1:sideways')).toBeNull()
  })
  it('throws when the id would exceed 64 bytes', () => {
    expect(() => feedbackCallbackData({ platform: 'freelancer', externalId: 'x'.repeat(60) }, 'up')).toThrow(/64/)
  })
  it('chosen keyboard shows the choice with a noop callback', () => {
    expect(feedbackChosenKeyboard('up')).toEqual({ inline_keyboard: [[{ text: '✅ Marked useful', callback_data: 'noop' }]] })
  })
  it('escapeHtml covers & < >', () => { expect(escapeHtml('a&b<c>')).toBe('a&amp;b&lt;c&gt;') })
})
