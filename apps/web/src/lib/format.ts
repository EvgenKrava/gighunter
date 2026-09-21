import type { Job, MatchStatus, Verdict } from '@gighunter/core/schema'

export type BadgeTone = 'green' | 'amber' | 'red' | 'slate' | 'brand'

export function timeAgo(iso: string, now = new Date()): string {
  const s = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function budgetLabel(b: Job['budget']): string {
  if (!b) return 'budget n/a'
  const range = b.min !== undefined && b.max !== undefined ? `$${b.min}–${b.max}` : b.min !== undefined ? `from $${b.min}` : b.max !== undefined ? `up to $${b.max}` : '$?'
  return b.type === 'hourly' ? `${range}/h ${b.currency} hourly` : `${range} ${b.currency} fixed`
}

export const verdictTone = (v?: Verdict): BadgeTone => (v === 'strong' ? 'green' : v === 'maybe' ? 'amber' : v === 'no' ? 'red' : 'slate')

export const statusLabel = (s: MatchStatus): string => ({ notified: 'Notified', pending: 'Sending', scored: 'Scored', filtered: 'Filtered' })[s]
