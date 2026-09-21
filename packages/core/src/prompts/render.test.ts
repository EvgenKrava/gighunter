import { describe, it, expect } from 'vitest'
import { defaultProfileFilters } from '../schema/index'
import {
  renderTemplate, renderProfile, renderJob, renderScore, resolvePrompts,
  buildScoringSystemPrompt, buildChatSystemPrompt, DEFAULT_SCORING_PROMPT, DEFAULT_QUICK_ACTIONS, SAMPLE_JOB, SAMPLE_MATCH,
} from './index'
import type { Profile } from '../schema/index'

const profile: Profile = {
  displayName: 'Yev', skills: [{ name: 'TypeScript', level: 'expert' }, { name: 'React', level: 'solid' }],
  budget: { min: 50, max: 500, currency: 'USD' }, maxHours: 6, languages: ['en', 'uk'], stopWords: ['wordpress'],
  freeText: 'I like small API integrations.', filters: defaultProfileFilters(), updatedAt: '2026-09-20T10:00:00.000Z',
}

describe('renderTemplate', () => {
  it('substitutes every placeholder present', () => {
    const out = renderTemplate('A {{profile}} B {{job}}', { app_context: 'ctx', profile: 'P', job: 'J' }, ['profile', 'job'])
    expect(out).toBe('A P B J')
  })
  it('appends required blocks that the template omits', () => {
    const out = renderTemplate('Only text', { app_context: 'ctx', profile: 'P', job: 'J' }, ['profile', 'job'])
    expect(out).toContain('Only text')
    expect(out).toContain('## Developer profile\nP')
    expect(out).toContain('## Job\nJ')
  })
  it('leaves unknown placeholders untouched', () => {
    expect(renderTemplate('{{nope}}', { app_context: 'c', profile: 'P' }, [])).toBe('{{nope}}')
  })
})

describe('renderers', () => {
  it('renderProfile lists skills with levels and budget', () => {
    const p = renderProfile(profile)
    expect(p).toContain('TypeScript (expert)')
    expect(p).toContain('$50–500 USD')
    expect(p).toContain('Max hours per gig: 6')
    expect(p).toContain('I like small API integrations.')
  })
  it('renderJob handles fixed, hourly and missing budgets', () => {
    expect(renderJob(SAMPLE_JOB)).toContain('Budget: $150–300 USD (fixed)')
    expect(renderJob({ ...SAMPLE_JOB, budget: { min: 20, max: 40, currency: 'USD', type: 'hourly' } })).toContain('Budget: $20–40/h USD (hourly)')
    expect(renderJob({ ...SAMPLE_JOB, budget: null })).toContain('Budget: not specified')
  })
  it('renderScore covers filtered, scored and unscored', () => {
    expect(renderScore({ status: 'filtered', filterReason: 'stale' })).toContain('reason: stale')
    expect(renderScore(SAMPLE_MATCH)).toContain('Score: 82/100 (strong)')
    expect(renderScore({ status: 'scored' })).toBe('Not scored yet.')
  })
})

describe('resolvePrompts + builders', () => {
  it('falls back to defaults field by field', () => {
    const r = resolvePrompts({ scoring: 'custom {{profile}}', updatedAt: '2026-09-20T10:00:00.000Z' })
    expect(r.scoring).toBe('custom {{profile}}')
    expect(r.chat).toContain('{{job}}')
    expect(r.quickActions).toEqual(DEFAULT_QUICK_ACTIONS)
    expect(resolvePrompts(null).scoring).toBe(DEFAULT_SCORING_PROMPT)
  })
  it('default scoring prompt renders with no leftover placeholders', () => {
    const out = buildScoringSystemPrompt(DEFAULT_SCORING_PROMPT, profile)
    expect(out).not.toMatch(/\{\{[a-z_]+\}\}/)
    expect(out).toContain('TypeScript (expert)')
    expect(out).toMatchSnapshot()
  })
  it('chat prompt includes job and score', () => {
    const out = buildChatSystemPrompt(resolvePrompts(null).chat, profile, SAMPLE_MATCH)
    expect(out).toContain(SAMPLE_JOB.title)
    expect(out).toContain('Score: 82/100')
    expect(out).not.toMatch(/\{\{[a-z_]+\}\}/)
  })
})
