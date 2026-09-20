import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { FreelancerSource } from '@gighunter/core/adapters'

const { values } = parseArgs({
  options: { query: { type: 'string', default: '' }, 'since-hours': { type: 'string', default: '24' }, 'save-fixture': { type: 'boolean', default: false } },
})
const token = process.env.FREELANCER_TOKEN
if (!token) throw new Error('set FREELANCER_TOKEN')

let lastRaw: unknown
const recordingFetch: typeof fetch = async (url, init) => {
  const res = await fetch(url, init)
  lastRaw = await res.clone().json().catch(() => undefined)
  return res
}
const src = new FreelancerSource(recordingFetch)

console.log('verifyToken:', await src.verifyToken(token))
const since = new Date(Date.now() - Number(values['since-hours']) * 3_600_000)
const jobs = await src.fetchRecent({ query: values.query ?? '', since, token })
console.log(`${jobs.length} jobs since ${since.toISOString()}`)
for (const j of jobs) {
  const b = j.budget ? `${j.budget.min ?? '?'}-${j.budget.max ?? '?'} ${j.budget.currency} ${j.budget.type}` : 'n/a'
  console.log(`- [${j.externalId}] ${j.title} | ${b} | ${j.postedAt} | ${j.skills.join(', ')}`)
}
if (values['save-fixture'] && lastRaw) {
  const path = 'packages/core/src/adapters/freelancer/__fixtures__/projects-active.json'
  writeFileSync(path, JSON.stringify(lastRaw, null, 2))
  console.log(`fixture written to ${path} — review it, then re-run core tests and adjust normalize.ts if fields differ`)
}
