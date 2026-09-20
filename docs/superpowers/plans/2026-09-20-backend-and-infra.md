# GigHunter Backend & Infra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy the serverless backend of GigHunter — domain core, four Lambdas, Terraform infrastructure — so that a seeded user receives AI-scored Freelancer.com gigs in their own Telegram bot every 15 minutes, and the HTTP API the web UI will consume is live.

**Architecture:** A pnpm monorepo. `packages/core` holds all domain logic behind injectable dependencies (DynamoDB store, SSM secrets, job-source adapters, Bedrock client factory, Telegram client) and a `runForUser` pipeline. `apps/lambdas` are thin handlers (poller, api via Hono, tg-webhook, pre-signup) bundled by esbuild. `infra/` is Terraform: bootstrap (state bucket) + main (everything else). The web SPA is a separate plan; this plan ships the API, hosting shell (S3/CloudFront/domain) and a seed script for end-to-end verification.

**Tech Stack:** TypeScript 5.9, Node 22 (Lambda, arm64), pnpm workspaces, zod 4, vitest 4, esbuild, `@anthropic-ai/bedrock-sdk` + `@anthropic-ai/sdk` (structured outputs), AWS SDK v3 (DynamoDB DocumentClient, SSM, Lambda), Hono 4, Terraform 1.16 with AWS provider 6.x.

**Spec:** `docs/superpowers/specs/2026-09-20-gighunter-design.md` — read it first; section numbers below refer to it.

## Global Constraints

- All docs, comments, commit messages in English.
- Git remote is `git@github-yevhenii:EvgenKrava/gighunter.git` (SSH alias `github-yevhenii`); AWS profile `yevhenii`, region `us-east-1`. Never use the default `github.com` SSH host for this repo.
- Commit messages: conventional prefix (`feat:`, `test:`, `chore:`, `infra:`, `docs:`), no co-author trailers.
- Lambda runtime `nodejs22.x`, architecture `arm64`; bundles are ESM `index.mjs` produced by esbuild, one directory per function under `apps/lambdas/dist/<name>/`.
- Default model constant: `global.anthropic.claude-haiku-4-5-20251001-v1:0` (spec §9). Legacy Bedrock client for ARN-versioned / 4.6-and-earlier models, Mantle client otherwise (spec §9).
- DynamoDB single table, `pk`/`sk`, GSI1 (`gsi1pk`/`gsi1sk`) for active users, GSI2 (`gsi2pk = USER#<sub>#<status>`, `gsi2sk = postedAt`) for match feeds (spec §5).
- Match statuses: `filtered | scored | pending | notified` (spec §5).
- Secrets only in SSM Parameter Store SecureString under `/gighunter/...` (spec §14). Never in DynamoDB, never in logs.
- User id (`sub`) always comes from the Cognito JWT claims, never from a request body (spec §12).
- Chat cap: 200 messages or 300 000 bytes serialized → 409 (spec §5).
- Telegram `callback_data` ≤ 64 bytes (spec §10.3).
- Every Lambda logs structured JSON lines via `packages/core/src/logger.ts`.
- Tests: vitest; no network in unit tests (fetch and AWS clients are injected/mocked).
- Domain `gighunter.onlytools.click`, Route53 zone `onlytools.click` (existing, id `Z0516204CSXC7Z2EC0FW`), ACM in `us-east-1`.
- `terraform apply` creates real resources in the user's account — run `terraform plan` first and confirm with the user before the first apply of each root.

---

## File map

```
gighunter/
├── package.json                      workspace root: scripts (build/test/typecheck), devDeps (typescript, vitest)
├── pnpm-workspace.yaml               packages/* apps/*
├── tsconfig.base.json                strict ESM config shared by all packages
├── .npmrc                            node-linker defaults
├── README.md                         what it is, how to run/test/deploy
├── packages/core/
│   ├── package.json                  @gighunter/core, exports map to ./src/**
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── src/
│       ├── index.ts                  barrel
│       ├── logger.ts                 createLogger(): structured JSON logger
│       ├── schema/                   zod schemas + types (one file per aggregate) + index
│       ├── prompts/                  defaults.ts, render.ts, index.ts
│       ├── filter/                   preFilter.ts, index.ts
│       ├── llm/                      client.ts (createBedrockClient, model helpers), index.ts
│       ├── scorer/                   scoreJob.ts, index.ts
│       ├── chat/                     runChatTurn.ts, index.ts
│       ├── notifier/                 telegram.ts (client), format.ts (messages/callback data), index.ts
│       ├── store/                    keys.ts, store.ts, index.ts
│       ├── secrets/                  secrets.ts, index.ts
│       ├── adapters/                 types.ts, freelancer/{source.ts,__fixtures__/}, upwork/source.ts, index.ts
│       ├── services/                 telegramSetup.ts, freelancerSetup.ts, chatService.ts, index.ts
│       └── pipeline/                 runForUser.ts, index.ts
├── apps/lambdas/
│   ├── package.json                  @gighunter/lambdas
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── build.mjs                     esbuild: one bundle per function
│   ├── src/shared/deps.ts            buildCoreDeps(): AWS clients, store, secrets, factories from env
│   ├── src/poller/{handler.ts,index.ts}
│   ├── src/pre-signup/{handler.ts,index.ts}
│   ├── src/tg-webhook/{handler.ts,index.ts}
│   └── src/api/{app.ts,auth.ts,errors.ts,deps.ts,index.ts,routes/*.ts}
├── scripts/                          seed-user.ts, poller-local.ts, freelancer-probe.ts (run with tsx)
└── infra/
    ├── bootstrap/main.tf             state bucket
    └── main/*.tf                     providers, variables, dynamodb, iam, lambdas, scheduler, api, cognito, dns, web, monitoring, outputs
```

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.npmrc`, `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/index.ts`, `packages/core/src/logger.ts`, `packages/core/src/logger.test.ts`, `apps/lambdas/package.json`, `apps/lambdas/tsconfig.json`, `apps/lambdas/vitest.config.ts`
- Modify: `README.md` (create)

**Interfaces:**
- Produces: `createLogger(base?: Record<string, unknown>): Logger` with `Logger = { info(event: string, data?: object): void; warn(...): void; error(...): void; child(extra: object): Logger }` — used by every later task.

- [ ] **Step 1: Root files**

`package.json`:
```json
{
  "name": "gighunter",
  "private": true,
  "engines": { "node": ">=22" },
  "packageManager": "pnpm@12.4.2",
  "scripts": {
    "build": "pnpm --filter @gighunter/lambdas build",
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck",
    "poller:local": "tsx scripts/poller-local.ts",
    "seed:user": "tsx scripts/seed-user.ts",
    "freelancer:probe": "tsx scripts/freelancer-probe.ts"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "tsx": "^4.23.0",
    "typescript": "^5.9.3",
    "vitest": "^4.1.0"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - packages/*
  - apps/*
```

`.npmrc`:
```
auto-install-peers=true
strict-peer-dependencies=false
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  }
}
```

- [ ] **Step 2: core package files**

`packages/core/package.json`:
```json
{
  "name": "@gighunter/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./schema": "./src/schema/index.ts",
    "./prompts": "./src/prompts/index.ts",
    "./filter": "./src/filter/index.ts",
    "./llm": "./src/llm/index.ts",
    "./scorer": "./src/scorer/index.ts",
    "./chat": "./src/chat/index.ts",
    "./notifier": "./src/notifier/index.ts",
    "./store": "./src/store/index.ts",
    "./secrets": "./src/secrets/index.ts",
    "./adapters": "./src/adapters/index.ts",
    "./services": "./src/services/index.ts",
    "./pipeline": "./src/pipeline/index.ts",
    "./logger": "./src/logger.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@anthropic-ai/bedrock-sdk": "^0.33.7",
    "@anthropic-ai/sdk": "^0.127.0",
    "@aws-sdk/client-dynamodb": "^3.1136.0",
    "@aws-sdk/client-ssm": "^3.1136.0",
    "@aws-sdk/lib-dynamodb": "^3.1136.0",
    "zod": "^4.6.0"
  },
  "devDependencies": {
    "aws-sdk-client-mock": "^4.1.0"
  }
}
```

`packages/core/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/core/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } })
```

`packages/core/src/index.ts`:
```ts
export * from './logger'
```

- [ ] **Step 3: Failing logger test**

`packages/core/src/logger.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createLogger } from './logger'

describe('createLogger', () => {
  it('writes one JSON line per call with level, event and merged fields', () => {
    const lines: string[] = []
    const log = createLogger({ fn: 'poller' }, (line) => lines.push(line))
    log.info('run.start', { userId: 'u1' })
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'info', event: 'run.start', fn: 'poller', userId: 'u1' })
  })

  it('child() adds fields to every subsequent line', () => {
    const lines: string[] = []
    const log = createLogger({}, (line) => lines.push(line)).child({ userId: 'u2' })
    log.warn('adapter.error', { platform: 'freelancer' })
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'warn', userId: 'u2', platform: 'freelancer' })
  })

  it('serializes Error values as message + name', () => {
    const lines: string[] = []
    const log = createLogger({}, (line) => lines.push(line))
    log.error('boom', { err: new Error('bad') })
    expect(JSON.parse(lines[0]!).err).toEqual({ name: 'Error', message: 'bad' })
  })
})
```

- [ ] **Step 4: Install and run test to verify it fails**

Run: `pnpm install && pnpm --filter @gighunter/core test`
Expected: FAIL — `Cannot find module './logger'`

- [ ] **Step 5: Implement logger**

`packages/core/src/logger.ts`:
```ts
export type LogFields = Record<string, unknown>

export interface Logger {
  info(event: string, fields?: LogFields): void
  warn(event: string, fields?: LogFields): void
  error(event: string, fields?: LogFields): void
  child(extra: LogFields): Logger
}

type Sink = (line: string) => void

function normalize(fields: LogFields): LogFields {
  const out: LogFields = {}
  for (const [k, v] of Object.entries(fields)) {
    out[k] = v instanceof Error ? { name: v.name, message: v.message } : v
  }
  return out
}

export function createLogger(base: LogFields = {}, sink: Sink = (l) => process.stdout.write(l + '\n')): Logger {
  const emit = (level: 'info' | 'warn' | 'error', event: string, fields: LogFields = {}) =>
    sink(JSON.stringify({ level, event, ts: new Date().toISOString(), ...normalize(base), ...normalize(fields) }))
  return {
    info: (e, f) => emit('info', e, f),
    warn: (e, f) => emit('warn', e, f),
    error: (e, f) => emit('error', e, f),
    child: (extra) => createLogger({ ...base, ...extra }, sink),
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @gighunter/core test`
Expected: 3 passed

- [ ] **Step 7: lambdas package skeleton**

`apps/lambdas/package.json`:
```json
{
  "name": "@gighunter/lambdas",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.1136.0",
    "@aws-sdk/client-lambda": "^3.1136.0",
    "@aws-sdk/client-ssm": "^3.1136.0",
    "@aws-sdk/lib-dynamodb": "^3.1136.0",
    "@gighunter/core": "workspace:*",
    "hono": "^4.13.0",
    "zod": "^4.6.0"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.163",
    "esbuild": "^0.28.0"
  }
}
```

`apps/lambdas/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`apps/lambdas/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } })
```

`README.md` (root):
```markdown
# GigHunter

Serverless radar for small freelance gigs: polls freelance platforms, scores each new job against your profile with Claude (Bedrock), and pushes matches to your own Telegram bot. Per-job chat drafts proposals with full context.

Design: `docs/superpowers/specs/2026-09-20-gighunter-design.md`.

## Layout

- `packages/core` — domain logic (schemas, adapters, filter, scorer, chat, notifier, store, pipeline)
- `apps/lambdas` — Lambda handlers: `poller`, `api`, `tg-webhook`, `pre-signup`
- `infra/` — Terraform (`bootstrap` = state bucket, `main` = everything else)
- `scripts/` — local runners (`seed:user`, `poller:local`, `freelancer:probe`)

## Develop

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build          # esbuild bundles into apps/lambdas/dist/<fn>/index.mjs
```

## Deploy

See `infra/README.md` (added with the infra tasks).
```

- [ ] **Step 8: Verify workspace resolves and typechecks**

Run: `pnpm install && pnpm typecheck && pnpm test`
Expected: typecheck passes for both packages (lambdas has no sources yet — tsc with empty include prints nothing and exits 0; if it errors with "No inputs were found", add `apps/lambdas/src/shared/deps.ts` as an empty `export {}` placeholder now — it is filled in Task 15), tests: 3 passed.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo with core and lambdas packages"
```

---

### Task 2: Domain schemas (zod)

**Files:**
- Create: `packages/core/src/schema/{common.ts,profile.ts,settings.ts,prompts.ts,job.ts,match.ts,run.ts,chat.ts,index.ts}`, `packages/core/src/schema/schema.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces (all exported from `@gighunter/core/schema`):
  - `PlatformSchema`, `Platform = 'freelancer' | 'upwork'`
  - `ProfileSchema`, `ProfileInputSchema` (no `updatedAt`), `Profile`, `ProfileInput`
  - `DEFAULT_MODEL`, `KNOWN_MODELS: { id: string; label: string }[]`, `SettingsSchema`, `SettingsPatchSchema`, `Settings`, `SettingsPatch`, `defaultSettings(now: string): Settings`
  - `PromptsSchema`, `PromptsPatchSchema`, `Prompts`, `PromptsPatch`, `QuickAction`
  - `JobSchema`, `Job`, `JobBudget`
  - `ScoreResultSchema`, `ScoreResult`, `VerdictSchema`, `Verdict`, `MatchStatusSchema`, `MatchStatus`, `MatchSchema`, `Match`, `MatchRef = { platform: Platform; externalId: string }`
  - `RunSchema`, `Run`, `RunPlatformStats`, `emptyPlatformStats()`
  - `ChatSchema`, `Chat`, `ChatMessage`, `CHAT_MAX_MESSAGES = 200`, `CHAT_MAX_BYTES = 300_000`
  - `Usage = { inputTokens: number; outputTokens: number }`, `UsageSchema`

- [ ] **Step 1: Failing schema tests**

`packages/core/src/schema/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  ProfileInputSchema, SettingsSchema, SettingsPatchSchema, defaultSettings, DEFAULT_MODEL,
  PromptsPatchSchema, JobSchema, MatchSchema, ScoreResultSchema,
} from './index'

const now = '2026-09-20T10:00:00.000Z'

describe('ProfileInputSchema', () => {
  it('accepts a minimal valid profile', () => {
    const r = ProfileInputSchema.safeParse({
      displayName: 'Yev', skills: [{ name: 'TypeScript', level: 'expert' }],
      budget: { min: 50, max: 500, currency: 'USD' }, maxHours: 6, languages: ['en'], stopWords: [], freeText: '',
    })
    expect(r.success).toBe(true)
  })
  it('rejects budget max < min', () => {
    const r = ProfileInputSchema.safeParse({
      displayName: 'Yev', skills: [], budget: { min: 500, max: 50, currency: 'USD' }, maxHours: 6, languages: ['en'], stopWords: [], freeText: '',
    })
    expect(r.success).toBe(false)
  })
})

describe('SettingsSchema', () => {
  it('defaultSettings fills every default', () => {
    const s = defaultSettings(now)
    expect(s).toMatchObject({
      active: false, notifyThreshold: 70, maxJobAgeHours: 24, model: DEFAULT_MODEL, chatModel: DEFAULT_MODEL,
      telegram: { tokenSet: false }, platforms: { freelancer: { enabled: false, query: '', tokenSet: false }, upwork: { enabled: false } }, updatedAt: now,
    })
  })
  it('parses a partial stored item into a full Settings', () => {
    const s = SettingsSchema.parse({ active: true, updatedAt: now })
    expect(s.notifyThreshold).toBe(70)
    expect(s.platforms.freelancer.query).toBe('')
  })
  it('patch rejects unknown keys and out-of-range threshold', () => {
    expect(SettingsPatchSchema.safeParse({ notifyThreshold: 101 }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ telegram: { webhookSecret: 'x' } }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ telegram: { chatId: '-100123' }, platforms: { freelancer: { enabled: true, query: 'react' } } }).success).toBe(true)
  })
})

describe('PromptsPatchSchema', () => {
  it('allows null to reset and limits quick actions to 8 unique labels', () => {
    expect(PromptsPatchSchema.safeParse({ scoring: null }).success).toBe(true)
    const nine = Array.from({ length: 9 }, (_, i) => ({ label: `a${i}`, text: 't' }))
    expect(PromptsPatchSchema.safeParse({ quickActions: nine }).success).toBe(false)
    const dup = [{ label: 'a', text: 't' }, { label: 'a', text: 'u' }]
    expect(PromptsPatchSchema.safeParse({ quickActions: dup }).success).toBe(false)
  })
})

describe('JobSchema / MatchSchema / ScoreResultSchema', () => {
  const job = {
    platform: 'freelancer', externalId: '123', url: 'https://www.freelancer.com/projects/x', title: 'T', description: 'D',
    budget: { min: 100, max: 200, currency: 'USD', type: 'fixed' }, skills: ['react'], postedAt: now,
  }
  it('accepts a job with null budget', () => {
    expect(JobSchema.safeParse({ ...job, budget: null }).success).toBe(true)
  })
  it('score must be an int in 0..100 and risks ≤ 4', () => {
    expect(ScoreResultSchema.safeParse({ score: 82, reasoning: 'ok', estimatedHours: 3, risks: [] }).success).toBe(true)
    expect(ScoreResultSchema.safeParse({ score: 101, reasoning: 'ok', estimatedHours: 3, risks: [] }).success).toBe(false)
    expect(ScoreResultSchema.safeParse({ score: 10, reasoning: 'ok', estimatedHours: 3, risks: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false)
  })
  it('match requires status and ttl', () => {
    expect(MatchSchema.safeParse({ job, status: 'pending', createdAt: now, ttl: 1 }).success).toBe(true)
    expect(MatchSchema.safeParse({ job, status: 'sent', createdAt: now, ttl: 1 }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gighunter/core test`
Expected: FAIL — cannot find `./index`

- [ ] **Step 3: Implement schemas**

`packages/core/src/schema/common.ts`:
```ts
import { z } from 'zod'

export const PlatformSchema = z.enum(['freelancer', 'upwork'])
export type Platform = z.infer<typeof PlatformSchema>

export const UsageSchema = z.object({ inputTokens: z.number().int().min(0), outputTokens: z.number().int().min(0) })
export type Usage = z.infer<typeof UsageSchema>

export const IsoDate = z.string().min(20)
```

`packages/core/src/schema/profile.ts`:
```ts
import { z } from 'zod'
import { IsoDate } from './common'

export const SkillLevelSchema = z.enum(['basic', 'solid', 'expert'])

export const ProfileInputSchema = z.object({
  displayName: z.string().min(1).max(100),
  skills: z.array(z.object({ name: z.string().min(1).max(50), level: SkillLevelSchema })).max(100),
  budget: z
    .object({ min: z.number().min(0), max: z.number().min(0), currency: z.literal('USD') })
    .refine((b) => b.max >= b.min, { message: 'budget.max must be >= budget.min' }),
  maxHours: z.number().positive().max(200),
  languages: z.array(z.string().length(2)).min(1).max(10),
  stopWords: z.array(z.string().min(1).max(50)).max(100),
  freeText: z.string().max(4000),
})
export const ProfileSchema = ProfileInputSchema.extend({ updatedAt: IsoDate })
export type ProfileInput = z.infer<typeof ProfileInputSchema>
export type Profile = z.infer<typeof ProfileSchema>
```

`packages/core/src/schema/settings.ts`:
```ts
import { z } from 'zod'
import { IsoDate } from './common'

export const DEFAULT_MODEL = 'global.anthropic.claude-haiku-4-5-20251001-v1:0'

export const KNOWN_MODELS: { id: string; label: string }[] = [
  { id: DEFAULT_MODEL, label: 'Claude Haiku 4.5 (fast, cheapest)' },
  { id: 'global.anthropic.claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'global.anthropic.claude-opus-4-6-v1', label: 'Claude Opus 4.6' },
  { id: 'anthropic.claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'anthropic.claude-opus-5', label: 'Claude Opus 5' },
]

export const TelegramSettingsSchema = z.object({
  tokenSet: z.boolean().default(false),
  tokenHint: z.string().optional(),
  botUsername: z.string().optional(),
  webhookSecret: z.string().optional(),
  chatId: z.string().optional(),
  chatTitle: z.string().optional(),
})

export const FreelancerSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  query: z.string().max(200).default(''),
  tokenSet: z.boolean().default(false),
  tokenHint: z.string().optional(),
  connectedAs: z.string().optional(),
})

export const SettingsSchema = z.object({
  active: z.boolean().default(false),
  notifyThreshold: z.number().int().min(0).max(100).default(70),
  maxJobAgeHours: z.number().int().min(1).max(168).default(24),
  model: z.string().min(1).default(DEFAULT_MODEL),
  chatModel: z.string().min(1).default(DEFAULT_MODEL),
  telegram: TelegramSettingsSchema.prefault({}),
  platforms: z
    .object({
      freelancer: FreelancerSettingsSchema.prefault({}),
      upwork: z.object({ enabled: z.literal(false).default(false) }).prefault({}),
    })
    .prefault({}),
  updatedAt: IsoDate,
})
export type Settings = z.infer<typeof SettingsSchema>

export const SettingsPatchSchema = z.strictObject({
  active: z.boolean().optional(),
  notifyThreshold: z.number().int().min(0).max(100).optional(),
  maxJobAgeHours: z.number().int().min(1).max(168).optional(),
  model: z.string().min(1).max(120).optional(),
  chatModel: z.string().min(1).max(120).optional(),
  platforms: z
    .strictObject({
      freelancer: z.strictObject({ enabled: z.boolean().optional(), query: z.string().max(200).optional() }).optional(),
    })
    .optional(),
  telegram: z.strictObject({ chatId: z.string().max(64).optional() }).optional(),
})
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

export function defaultSettings(now: string): Settings {
  return SettingsSchema.parse({ updatedAt: now })
}
```

`packages/core/src/schema/prompts.ts`:
```ts
import { z } from 'zod'
import { IsoDate } from './common'

export const QuickActionSchema = z.object({ label: z.string().min(1).max(40), text: z.string().min(1).max(2000) })
export type QuickAction = z.infer<typeof QuickActionSchema>

const uniqueLabels = (qa: QuickAction[]) => new Set(qa.map((q) => q.label)).size === qa.length
const QuickActionsSchema = z.array(QuickActionSchema).min(1).max(8).refine(uniqueLabels, { message: 'quick action labels must be unique' })
const Template = z.string().trim().min(1).max(8000)

export const PromptsSchema = z.object({
  scoring: Template.optional(),
  chat: Template.optional(),
  quickActions: QuickActionsSchema.optional(),
  updatedAt: IsoDate,
})
export type Prompts = z.infer<typeof PromptsSchema>

export const PromptsPatchSchema = z.strictObject({
  scoring: Template.nullable().optional(),
  chat: Template.nullable().optional(),
  quickActions: QuickActionsSchema.nullable().optional(),
})
export type PromptsPatch = z.infer<typeof PromptsPatchSchema>
```

`packages/core/src/schema/job.ts`:
```ts
import { z } from 'zod'
import { IsoDate, PlatformSchema } from './common'

export const JobBudgetSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  currency: z.string().min(1),
  type: z.enum(['fixed', 'hourly']),
})
export type JobBudget = z.infer<typeof JobBudgetSchema>

export const JobSchema = z.object({
  platform: PlatformSchema,
  externalId: z.string().min(1),
  url: z.url(),
  title: z.string(),
  description: z.string(),
  budget: JobBudgetSchema.nullable(),
  skills: z.array(z.string()),
  postedAt: IsoDate,
  language: z.string().optional(),
  client: z
    .object({
      country: z.string().optional(),
      rating: z.number().optional(),
      reviews: z.number().optional(),
      paymentVerified: z.boolean().optional(),
    })
    .optional(),
})
export type Job = z.infer<typeof JobSchema>
```

`packages/core/src/schema/match.ts`:
```ts
import { z } from 'zod'
import { IsoDate, PlatformSchema } from './common'
import { JobSchema } from './job'

export const ScoreResultSchema = z.object({
  score: z.number().int().min(0).max(100),
  reasoning: z.string().min(1),
  estimatedHours: z.number().min(0),
  risks: z.array(z.string()).max(4),
})
export type ScoreResult = z.infer<typeof ScoreResultSchema>

export const VerdictSchema = z.enum(['strong', 'maybe', 'no'])
export type Verdict = z.infer<typeof VerdictSchema>

export const MatchStatusSchema = z.enum(['filtered', 'scored', 'pending', 'notified'])
export type MatchStatus = z.infer<typeof MatchStatusSchema>

export const FeedbackSchema = z.enum(['up', 'down'])
export type Feedback = z.infer<typeof FeedbackSchema>

export const MatchSchema = z.object({
  job: JobSchema,
  status: MatchStatusSchema,
  filterReason: z.string().optional(),
  score: ScoreResultSchema.optional(),
  verdict: VerdictSchema.optional(),
  feedback: FeedbackSchema.optional(),
  telegramMessageId: z.number().optional(),
  createdAt: IsoDate,
  scoredAt: IsoDate.optional(),
  notifiedAt: IsoDate.optional(),
  feedbackAt: IsoDate.optional(),
  ttl: z.number().int(),
})
export type Match = z.infer<typeof MatchSchema>

export const MatchRefSchema = z.object({ platform: PlatformSchema, externalId: z.string().min(1) })
export type MatchRef = z.infer<typeof MatchRefSchema>
```

`packages/core/src/schema/run.ts`:
```ts
import { z } from 'zod'
import { IsoDate, UsageSchema } from './common'

export const RunPlatformStatsSchema = z.object({
  fetched: z.number().int().default(0),
  new: z.number().int().default(0),
  filtered: z.number().int().default(0),
  scored: z.number().int().default(0),
  notified: z.number().int().default(0),
  error: z.string().optional(),
})
export type RunPlatformStats = z.infer<typeof RunPlatformStatsSchema>
export const emptyPlatformStats = (): RunPlatformStats => ({ fetched: 0, new: 0, filtered: 0, scored: 0, notified: 0 })

export const RunSchema = z.object({
  startedAt: IsoDate,
  finishedAt: IsoDate.optional(),
  trigger: z.enum(['schedule', 'manual']),
  perPlatform: z.record(z.string(), RunPlatformStatsSchema),
  usage: UsageSchema,
  errors: z.array(z.string()),
  ttl: z.number().int(),
})
export type Run = z.infer<typeof RunSchema>
```

`packages/core/src/schema/chat.ts`:
```ts
import { z } from 'zod'
import { IsoDate, UsageSchema } from './common'

export const CHAT_MAX_MESSAGES = 200
export const CHAT_MAX_BYTES = 300_000

export const ChatMessageSchema = z.object({ role: z.enum(['user', 'assistant']), content: z.string(), at: IsoDate })
export type ChatMessage = z.infer<typeof ChatMessageSchema>

export const ChatSchema = z.object({
  messages: z.array(ChatMessageSchema),
  usage: UsageSchema,
  createdAt: IsoDate,
  updatedAt: IsoDate,
  ttl: z.number().int(),
})
export type Chat = z.infer<typeof ChatSchema>
```

`packages/core/src/schema/index.ts`:
```ts
export * from './common'
export * from './profile'
export * from './settings'
export * from './prompts'
export * from './job'
export * from './match'
export * from './run'
export * from './chat'
```

Append to `packages/core/src/index.ts`:
```ts
export * from './schema/index'
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @gighunter/core test && pnpm --filter @gighunter/core typecheck`
Expected: all schema tests pass; no type errors. If `prefault` is not found, the installed zod is < 4 — check `pnpm ls zod` and fix the version.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): domain schemas for profile, settings, prompts, job, match, run, chat"
```

---

### Task 3: Prompt templates and rendering

**Files:**
- Create: `packages/core/src/prompts/{defaults.ts,render.ts,index.ts}`, `packages/core/src/prompts/render.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Profile`, `Job`, `Match`, `Prompts`, `QuickAction` (Task 2)
- Produces (`@gighunter/core/prompts`):
  - `APP_CONTEXT`, `DEFAULT_SCORING_PROMPT`, `DEFAULT_CHAT_PROMPT`, `DEFAULT_QUICK_ACTIONS: QuickAction[]`
  - `renderTemplate(template: string, blocks: RenderBlocks, required: RenderKey[]): string`
  - `renderProfile(profile: Profile): string`, `renderJob(job: Job): string`, `renderScore(match: Pick<Match, 'status' | 'filterReason' | 'score' | 'verdict'>): string`
  - `resolvePrompts(overrides: Prompts | null): ResolvedPrompts` where `ResolvedPrompts = { scoring: string; chat: string; quickActions: QuickAction[] }`
  - `buildScoringSystemPrompt(template: string, profile: Profile): string`
  - `buildChatSystemPrompt(template: string, profile: Profile, match: Match): string`
  - `SAMPLE_JOB: Job`, `SAMPLE_MATCH: Match` (used by the preview endpoint)

- [ ] **Step 1: Failing tests**

`packages/core/src/prompts/render.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  renderTemplate, renderProfile, renderJob, renderScore, resolvePrompts,
  buildScoringSystemPrompt, buildChatSystemPrompt, DEFAULT_SCORING_PROMPT, DEFAULT_QUICK_ACTIONS, SAMPLE_JOB, SAMPLE_MATCH,
} from './index'
import type { Profile } from '../schema/index'

const profile: Profile = {
  displayName: 'Yev', skills: [{ name: 'TypeScript', level: 'expert' }, { name: 'React', level: 'solid' }],
  budget: { min: 50, max: 500, currency: 'USD' }, maxHours: 6, languages: ['en', 'uk'], stopWords: ['wordpress'],
  freeText: 'I like small API integrations.', updatedAt: '2026-09-20T10:00:00.000Z',
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gighunter/core test -- prompts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement**

`packages/core/src/prompts/defaults.ts`:
```ts
import type { QuickAction } from '../schema/index'

export const APP_CONTEXT = `GigHunter is a personal radar for small freelance side gigs. The developer using it has a full-time job and wants short, well-scoped tasks to do in the evenings (typically a few hours each), often with the help of an AI coding assistant. They value closed scope, clear deliverables, fair budgets and clients who know what they want. They are not looking for long-term engagements, team positions, or open-ended "ongoing" work.`

export const DEFAULT_SCORING_PROMPT = `You evaluate freelance job posts for one specific developer and decide how good a fit each post is.

{{app_context}}

## The developer
{{profile}}

## How to score
Return a score from 0 to 100:
- 80-100 (strong): closed scope, clear deliverable, realistically done within the developer's max hours, matches skills at "solid" or "expert" level OR is straightforward to complete with an AI coding assistant, budget is fair for the effort.
- 50-79 (maybe): mostly fits, but one thing is unclear — scope, budget, or skill overlap.
- 0-49 (no): long-term or ongoing engagement, "we need a team", vague or huge scope, unrealistic budget-to-effort ratio, requires skills the developer lacks, suspicious client.

Estimate the hours the developer would need. List up to 4 concrete risks (an empty list if none). Keep the reasoning to 1-3 sentences a busy person can scan on a phone.`

export const DEFAULT_CHAT_PROMPT = `You are the assistant inside GigHunter, helping one developer decide on and apply to a freelance job.

{{app_context}}

## The developer
{{profile}}

## The job
{{job}}

## GigHunter's assessment
{{score}}

## How to help
- Write in the developer's voice (first person), concrete and friendly, no fluff.
- Proposals and cover letters: short (under 150 words unless asked otherwise), lead with the most relevant experience, mention one specific detail from the job, end with a clear next step. Freelance platforms favour brevity.
- Never invent experience, tools or results the profile does not support. If something important is missing, ask the developer instead of guessing.
- Effort estimates: break the work into steps with hours; flag unknowns.
- When asked for questions to the client, list 3-6 crisp questions that would change the scope or price.`

export const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  { label: 'Draft proposal', text: 'Draft a proposal / cover letter for this job in my voice. Keep it under 150 words, mention one specific detail from the job, and end with a clear next step.' },
  { label: 'Estimate effort', text: 'Estimate the effort for this job: break it into steps with hours, note assumptions, and flag anything that could blow up the scope.' },
  { label: 'Questions for the client', text: 'List the questions I should ask the client before quoting — the ones that would change scope or price.' },
  { label: 'Summarize the job', text: 'Summarize this job in 5 bullets: what they want, the deliverable, tech, budget vs effort, red flags.' },
]
```

`packages/core/src/prompts/render.ts`:
```ts
import type { Job, Match, Profile, Prompts, QuickAction } from '../schema/index'
import { APP_CONTEXT, DEFAULT_CHAT_PROMPT, DEFAULT_QUICK_ACTIONS, DEFAULT_SCORING_PROMPT } from './defaults'

export type RenderKey = 'app_context' | 'profile' | 'job' | 'score'
export type RenderBlocks = Partial<Record<RenderKey, string>> & { app_context: string; profile: string }

const HEADINGS: Record<RenderKey, string> = {
  app_context: 'Context',
  profile: 'Developer profile',
  job: 'Job',
  score: "GigHunter's assessment",
}

export function renderTemplate(template: string, blocks: RenderBlocks, required: RenderKey[]): string {
  let out = template
  for (const [key, value] of Object.entries(blocks) as [RenderKey, string | undefined][]) {
    if (value === undefined) continue
    out = out.split(`{{${key}}}`).join(value)
  }
  for (const key of required) {
    if (!template.includes(`{{${key}}}`) && blocks[key] !== undefined) {
      out += `\n\n## ${HEADINGS[key]}\n${blocks[key]}`
    }
  }
  return out
}

const money = (min?: number, max?: number) =>
  min !== undefined && max !== undefined ? `$${min}–${max}` : min !== undefined ? `from $${min}` : max !== undefined ? `up to $${max}` : ''

export function renderProfile(p: Profile): string {
  const skills = p.skills.length ? p.skills.map((s) => `${s.name} (${s.level})`).join(', ') : '(none listed)'
  return [
    `Name: ${p.displayName}`,
    `Skills: ${skills}`,
    `Budget per gig: $${p.budget.min}–${p.budget.max} ${p.budget.currency} (fixed price)`,
    `Max hours per gig: ${p.maxHours}`,
    `Languages: ${p.languages.join(', ')}`,
    `Stop words: ${p.stopWords.length ? p.stopWords.join(', ') : '(none)'}`,
    `About / what I'm looking for:`,
    p.freeText.trim() || '(not provided)',
  ].join('\n')
}

export function renderJob(j: Job): string {
  let budget = 'not specified'
  if (j.budget) {
    const range = money(j.budget.min, j.budget.max)
    budget = j.budget.type === 'hourly' ? `${range}/h ${j.budget.currency} (hourly)` : `${range} ${j.budget.currency} (fixed)`
  }
  const client = j.client
    ? [
        j.client.country && `country ${j.client.country}`,
        j.client.rating !== undefined && `rating ${j.client.rating}`,
        j.client.reviews !== undefined && `${j.client.reviews} reviews`,
        j.client.paymentVerified !== undefined && (j.client.paymentVerified ? 'payment verified' : 'payment NOT verified'),
      ].filter(Boolean).join(', ')
    : 'unknown'
  return [
    `Title: ${j.title}`,
    `Platform: ${j.platform}`,
    `URL: ${j.url}`,
    `Budget: ${budget}`,
    `Skills: ${j.skills.length ? j.skills.join(', ') : '(none listed)'}`,
    `Posted: ${j.postedAt}`,
    `Language: ${j.language ?? 'unknown'}`,
    `Client: ${client || 'unknown'}`,
    `Description:`,
    j.description.trim(),
  ].join('\n')
}

export function renderScore(m: Pick<Match, 'status' | 'filterReason' | 'score' | 'verdict'>): string {
  if (m.status === 'filtered') return `Pre-filter rejected this job (reason: ${m.filterReason ?? 'unknown'}); it was not scored.`
  if (!m.score) return 'Not scored yet.'
  const risks = m.score.risks.length ? m.score.risks.join('; ') : 'none'
  return [
    `Score: ${m.score.score}/100 (${m.verdict ?? 'n/a'})`,
    `Reasoning: ${m.score.reasoning}`,
    `Estimated hours: ${m.score.estimatedHours}`,
    `Risks: ${risks}`,
  ].join('\n')
}

export interface ResolvedPrompts { scoring: string; chat: string; quickActions: QuickAction[] }

export function resolvePrompts(overrides: Prompts | null): ResolvedPrompts {
  return {
    scoring: overrides?.scoring ?? DEFAULT_SCORING_PROMPT,
    chat: overrides?.chat ?? DEFAULT_CHAT_PROMPT,
    quickActions: overrides?.quickActions ?? DEFAULT_QUICK_ACTIONS,
  }
}

export function buildScoringSystemPrompt(template: string, profile: Profile): string {
  return renderTemplate(template, { app_context: APP_CONTEXT, profile: renderProfile(profile) }, ['profile'])
}

export function buildChatSystemPrompt(template: string, profile: Profile, match: Match): string {
  return renderTemplate(
    template,
    { app_context: APP_CONTEXT, profile: renderProfile(profile), job: renderJob(match.job), score: renderScore(match) },
    ['profile', 'job', 'score'],
  )
}

export const SAMPLE_JOB: Job = {
  platform: 'freelancer',
  externalId: 'sample-1',
  url: 'https://www.freelancer.com/projects/sample-1',
  title: 'Fix Stripe webhook retries in a Next.js app',
  description:
    'Our Next.js 14 app receives Stripe webhooks but occasionally double-processes events after retries. Need idempotency keys stored in Postgres (Prisma) and a small test. Repo access provided. Should be a few hours for someone who has done this before.',
  budget: { min: 150, max: 300, currency: 'USD', type: 'fixed' },
  skills: ['Next.js', 'Stripe', 'PostgreSQL'],
  postedAt: '2026-09-20T09:30:00.000Z',
  language: 'en',
  client: { country: 'US', rating: 4.8, reviews: 12, paymentVerified: true },
}

export const SAMPLE_MATCH: Match = {
  job: SAMPLE_JOB,
  status: 'notified',
  score: {
    score: 82,
    reasoning: 'Exact Next.js + Stripe match, closed scope with a clear deliverable and tests.',
    estimatedHours: 3,
    risks: ['Repo state unknown', 'Client may expect ongoing support'],
  },
  verdict: 'strong',
  createdAt: '2026-09-20T09:45:00.000Z',
  scoredAt: '2026-09-20T09:45:05.000Z',
  notifiedAt: '2026-09-20T09:45:06.000Z',
  ttl: 1_763_000_000,
}
```

`packages/core/src/prompts/index.ts`:
```ts
export * from './defaults'
export * from './render'
```

Append to `packages/core/src/index.ts`: `export * from './prompts/index'`

- [ ] **Step 4: Run tests (snapshot is written on first run) and typecheck**

Run: `pnpm --filter @gighunter/core test && pnpm --filter @gighunter/core typecheck`
Expected: all pass; a `__snapshots__/render.test.ts.snap` file appears — open it and confirm the rendered default prompt reads well (no double blank lines, profile fields present).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): default prompt templates and placeholder rendering"
```

---

### Task 4: Deterministic pre-filter

**Files:**
- Create: `packages/core/src/filter/{preFilter.ts,index.ts}`, `packages/core/src/filter/preFilter.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Job`, `Profile`, `Settings` (Task 2)
- Produces: `preFilter(job: Job, profile: Pick<Profile, 'stopWords' | 'languages' | 'budget'>, settings: Pick<Settings, 'maxJobAgeHours'>, now: Date): string | null` — `null` means "passes", otherwise a `filterReason` string.

- [ ] **Step 1: Failing table-driven test**

`packages/core/src/filter/preFilter.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { preFilter } from './preFilter'
import type { Job } from '../schema/index'

const now = new Date('2026-09-20T12:00:00.000Z')
const profile = { stopWords: ['wordpress', 'long term'], languages: ['en'], budget: { min: 50, max: 500, currency: 'USD' as const } }
const settings = { maxJobAgeHours: 24 }
const base: Job = {
  platform: 'freelancer', externalId: '1', url: 'https://x.test/1', title: 'Build a React widget', description: 'Small task',
  budget: { min: 100, max: 200, currency: 'USD', type: 'fixed' }, skills: [], postedAt: '2026-09-20T10:00:00.000Z', language: 'en',
}

const cases: [string, Partial<Job>, string | null][] = [
  ['passes a good job', {}, null],
  ['stale: older than maxJobAgeHours', { postedAt: '2026-09-18T10:00:00.000Z' }, 'stale'],
  ['stop word in title, case-insensitive', { title: 'WordPress plugin fix' }, 'stop_word:wordpress'],
  ['stop phrase in description', { description: 'Looking for a Long Term partner' }, 'stop_word:long term'],
  ['stop word must match whole words (java vs javascript)', { title: 'javascript', description: '' }, null],
  ['language not in profile', { language: 'de' }, 'language'],
  ['unknown language passes', { language: undefined }, null],
  ['fixed budget max below profile min', { budget: { min: 10, max: 30, currency: 'USD', type: 'fixed' } }, 'budget_below_min'],
  ['fixed budget min above profile max', { budget: { min: 600, max: 900, currency: 'USD', type: 'fixed' } }, 'budget_above_max'],
  ['hourly budget is not checked', { budget: { min: 5, max: 10, currency: 'USD', type: 'hourly' } }, null],
  ['null budget is not checked', { budget: null }, null],
  ['stale wins over stop word (order)', { postedAt: '2026-09-01T00:00:00.000Z', title: 'wordpress' }, 'stale'],
]

describe('preFilter', () => {
  it.each(cases)('%s', (_name, patch, expected) => {
    const job = { ...base, ...patch }
    const stopWords = profile.stopWords.map((w) => w === 'wordpress' && _name.includes('java') ? 'java' : w)
    expect(preFilter(job, { ...profile, stopWords }, settings, now)).toBe(expected)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gighunter/core test -- filter`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`packages/core/src/filter/preFilter.ts`:
```ts
import type { Job, Profile, Settings } from '../schema/index'

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Cheap deterministic rejection before any LLM call. Rules run in order; first hit wins.
 * Returns null when the job should be scored.
 */
export function preFilter(
  job: Job,
  profile: Pick<Profile, 'stopWords' | 'languages' | 'budget'>,
  settings: Pick<Settings, 'maxJobAgeHours'>,
  now: Date,
): string | null {
  const ageMs = now.getTime() - new Date(job.postedAt).getTime()
  if (ageMs > settings.maxJobAgeHours * 3_600_000) return 'stale'

  const haystack = `${job.title}\n${job.description}`
  for (const word of profile.stopWords) {
    const re = new RegExp(`\\b${escapeRegExp(word.trim())}\\b`, 'i')
    if (word.trim() && re.test(haystack)) return `stop_word:${word.toLowerCase()}`
  }

  if (job.language && !profile.languages.map((l) => l.toLowerCase()).includes(job.language.toLowerCase())) return 'language'

  if (job.budget && job.budget.type === 'fixed') {
    if (job.budget.max !== undefined && job.budget.max < profile.budget.min) return 'budget_below_min'
    if (job.budget.min !== undefined && job.budget.min > profile.budget.max) return 'budget_above_max'
  }
  return null
}
```

`packages/core/src/filter/index.ts`: `export * from './preFilter'`
Append to `packages/core/src/index.ts`: `export * from './filter/index'`

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @gighunter/core test -- filter`
Expected: 12 passed

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): deterministic pre-filter with ordered rules"
```

---

### Task 5: Bedrock client factory and model helpers

**Files:**
- Create: `packages/core/src/llm/{client.ts,index.ts}`, `packages/core/src/llm/client.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces (`@gighunter/core/llm`):
  - `usesMantle(modelId: string): boolean`, `supportsAdaptiveThinking(modelId: string): boolean`
  - `type CreateParams = Anthropic.MessageCreateParamsNonStreaming`
  - `interface LlmClient { messages: { create(params: CreateParams): Promise<Anthropic.Message>; parse<T>(params: Record<string, unknown>): Promise<ParsedResponse<T>> } }` with `ParsedResponse<T> = { parsed_output: T | null; usage: Anthropic.Usage; stop_reason: string | null }`
  - `createBedrockClient(modelId: string, region?: string): LlmClient`
  - `usageFrom(u: Anthropic.Usage): Usage` (sums uncached + cache-read + cache-creation input tokens)

- [ ] **Step 1: Failing tests**

`packages/core/src/llm/client.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { usesMantle, supportsAdaptiveThinking, usageFrom } from './client'

describe('model routing', () => {
  it.each([
    ['global.anthropic.claude-haiku-4-5-20251001-v1:0', false, false],
    ['global.anthropic.claude-sonnet-4-6', false, true],
    ['global.anthropic.claude-opus-4-6-v1', false, true],
    ['anthropic.claude-sonnet-5', true, true],
    ['anthropic.claude-opus-5', true, true],
    ['anthropic.claude-opus-4-7', true, true],
  ])('%s → mantle=%s adaptive=%s', (id, mantle, adaptive) => {
    expect(usesMantle(id)).toBe(mantle)
    expect(supportsAdaptiveThinking(id)).toBe(adaptive)
  })
})

describe('usageFrom', () => {
  it('sums all input token kinds', () => {
    expect(usageFrom({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 } as never))
      .toEqual({ inputTokens: 130, outputTokens: 5 })
    expect(usageFrom({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: null, cache_creation_input_tokens: null } as never))
      .toEqual({ inputTokens: 10, outputTokens: 5 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gighunter/core test -- llm`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`packages/core/src/llm/client.ts`:
```ts
import AnthropicBedrock, { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk'
import type Anthropic from '@anthropic-ai/sdk'
import type { Usage } from '../schema/index'

export type CreateParams = Anthropic.MessageCreateParamsNonStreaming

export interface ParsedResponse<T> {
  parsed_output: T | null
  usage: Anthropic.Usage
  stop_reason: string | null
}

/** The slice of the Anthropic client surface this codebase uses; both Bedrock clients satisfy it at runtime. */
export interface LlmClient {
  messages: {
    create(params: CreateParams): Promise<Anthropic.Message>
    parse<T>(params: Record<string, unknown>): Promise<ParsedResponse<T>>
  }
}

// Models served by the Messages-API Bedrock endpoint (Mantle). Everything else is the legacy InvokeModel stack.
const MANTLE_PATTERNS = [/claude-opus-4-7/, /claude-opus-4-8/, /claude-opus-5/, /claude-sonnet-5/, /claude-fable/, /claude-mythos/]

export function usesMantle(modelId: string): boolean {
  return MANTLE_PATTERNS.some((re) => re.test(modelId))
}

/** Adaptive thinking exists from the 4.6 generation on; Haiku 4.5 / Sonnet 4.5 / Opus 4.5 do not take it. */
export function supportsAdaptiveThinking(modelId: string): boolean {
  return usesMantle(modelId) || /claude-(opus|sonnet)-4-6/.test(modelId)
}

export function createBedrockClient(modelId: string, region = process.env.AWS_REGION ?? 'us-east-1'): LlmClient {
  const client = usesMantle(modelId) ? new AnthropicBedrockMantle({ awsRegion: region }) : new AnthropicBedrock({ awsRegion: region })
  return client as unknown as LlmClient
}

export function usageFrom(u: Anthropic.Usage): Usage {
  return {
    inputTokens: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    outputTokens: u.output_tokens,
  }
}
```

`packages/core/src/llm/index.ts`: `export * from './client'`
Append to `packages/core/src/index.ts`: `export * from './llm/index'`

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @gighunter/core test -- llm && pnpm --filter @gighunter/core typecheck`
Expected: pass. If `AnthropicBedrockMantle` is not a named export of the installed `@anthropic-ai/bedrock-sdk`, run `grep -n "Mantle" node_modules/@anthropic-ai/bedrock-sdk/index.d.ts` from `packages/core` and adjust the import to the exported name.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): Bedrock client factory with legacy/Mantle routing"
```

---

### Task 6: Scorer (structured outputs)

**Files:**
- Create: `packages/core/src/scorer/{scoreJob.ts,index.ts}`, `packages/core/src/scorer/scoreJob.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `LlmClient`, `usageFrom` (Task 5); `renderJob` (Task 3); `ScoreResultSchema`, `Verdict`, `Job` (Task 2)
- Produces (`@gighunter/core/scorer`):
  - `ScoreOutputSchema` (zod, no numeric bounds — what the model is asked for)
  - `class ScoringError extends Error`
  - `verdictFor(score: number): Verdict` — ≥80 strong, ≥50 maybe, else no
  - `scoreJob(args: { client: LlmClient; model: string; systemPrompt: string; job: Job }): Promise<{ result: ScoreResult; verdict: Verdict; usage: Usage }>`

- [ ] **Step 1: Failing tests**

`packages/core/src/scorer/scoreJob.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { scoreJob, verdictFor, ScoringError } from './scoreJob'
import { SAMPLE_JOB } from '../prompts/index'
import type { LlmClient } from '../llm/index'

function fakeClient(parsed: unknown, usage = { input_tokens: 500, output_tokens: 80, cache_read_input_tokens: 1200, cache_creation_input_tokens: 0 }) {
  const parse = vi.fn().mockResolvedValue({ parsed_output: parsed, usage, stop_reason: 'end_turn' })
  const client = { messages: { create: vi.fn(), parse } } as unknown as LlmClient
  return { client, parse }
}

describe('verdictFor', () => {
  it('maps thresholds', () => {
    expect(verdictFor(80)).toBe('strong'); expect(verdictFor(79)).toBe('maybe'); expect(verdictFor(50)).toBe('maybe'); expect(verdictFor(49)).toBe('no')
  })
})

describe('scoreJob', () => {
  it('sends system prompt with cache_control and the rendered job, returns normalized result + usage', async () => {
    const { client, parse } = fakeClient({ score: 82.4, reasoning: ' Great fit. ', estimatedHours: 3, risks: ['a', 'b', 'c', 'd', 'e'] })
    const out = await scoreJob({ client, model: 'm', systemPrompt: 'SYS', job: SAMPLE_JOB })
    const params = parse.mock.calls[0]![0] as Record<string, unknown>
    expect(params.model).toBe('m')
    expect(params.system).toEqual([{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }])
    expect((params.messages as { content: string }[])[0]!.content).toContain(SAMPLE_JOB.title)
    expect(params).toHaveProperty('output_config.format')
    expect(out.result).toEqual({ score: 82, reasoning: 'Great fit.', estimatedHours: 3, risks: ['a', 'b', 'c', 'd'] })
    expect(out.verdict).toBe('strong')
    expect(out.usage).toEqual({ inputTokens: 1700, outputTokens: 80 })
  })
  it('clamps score into 0..100', async () => {
    const { client } = fakeClient({ score: 140, reasoning: 'x', estimatedHours: -2, risks: [] })
    const out = await scoreJob({ client, model: 'm', systemPrompt: 'S', job: SAMPLE_JOB })
    expect(out.result.score).toBe(100)
    expect(out.result.estimatedHours).toBe(0)
  })
  it('throws ScoringError when parsed_output is null', async () => {
    const { client } = fakeClient(null)
    await expect(scoreJob({ client, model: 'm', systemPrompt: 'S', job: SAMPLE_JOB })).rejects.toBeInstanceOf(ScoringError)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gighunter/core test -- scorer`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`packages/core/src/scorer/scoreJob.ts`:
```ts
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { LlmClient } from '../llm/index'
import { usageFrom } from '../llm/index'
import { renderJob } from '../prompts/index'
import { ScoreResultSchema, type Job, type ScoreResult, type Usage, type Verdict } from '../schema/index'

/** What the model is asked to produce. Numeric bounds are enforced after the call (structured outputs do not support min/max). */
export const ScoreOutputSchema = z.object({
  score: z.number().int().describe('Fit score from 0 (no fit) to 100 (perfect evening gig)'),
  reasoning: z.string().describe('1-3 sentences explaining the score, written to be scanned on a phone'),
  estimatedHours: z.number().describe('Estimated hours the developer needs to deliver'),
  risks: z.array(z.string()).describe('Up to 4 short, concrete risks; empty array if none'),
})
type ScoreOutput = z.infer<typeof ScoreOutputSchema>

export class ScoringError extends Error {
  constructor(message: string) { super(message); this.name = 'ScoringError' }
}

export function verdictFor(score: number): Verdict {
  return score >= 80 ? 'strong' : score >= 50 ? 'maybe' : 'no'
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export async function scoreJob(args: { client: LlmClient; model: string; systemPrompt: string; job: Job }): Promise<{ result: ScoreResult; verdict: Verdict; usage: Usage }> {
  const response = await args.client.messages.parse<ScoreOutput>({
    model: args.model,
    max_tokens: 1024,
    system: [{ type: 'text', text: args.systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: renderJob(args.job) }],
    output_config: { format: zodOutputFormat(ScoreOutputSchema) },
  })
  const raw = response.parsed_output
  if (!raw) throw new ScoringError(`model returned no parseable output (stop_reason=${response.stop_reason})`)
  const result = ScoreResultSchema.parse({
    score: clamp(Math.round(raw.score), 0, 100),
    reasoning: raw.reasoning.trim() || 'No reasoning provided.',
    estimatedHours: Math.max(0, raw.estimatedHours),
    risks: raw.risks.slice(0, 4),
  })
  return { result, verdict: verdictFor(result.score), usage: usageFrom(response.usage) }
}
```

`packages/core/src/scorer/index.ts`: `export * from './scoreJob'`
Append to `packages/core/src/index.ts`: `export * from './scorer/index'`

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @gighunter/core test -- scorer && pnpm --filter @gighunter/core typecheck`
Expected: pass. If `@anthropic-ai/sdk/helpers/zod` cannot be resolved, check `ls node_modules/@anthropic-ai/sdk/helpers/` from `packages/core` for the actual path.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): job scorer using Bedrock structured outputs"
```

---

### Task 7: Chat turn runner

**Files:**
- Create: `packages/core/src/chat/{runChatTurn.ts,index.ts}`, `packages/core/src/chat/runChatTurn.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `LlmClient`, `CreateParams`, `supportsAdaptiveThinking`, `usageFrom` (Task 5); `ChatMessage`, `Usage` (Task 2)
- Produces (`@gighunter/core/chat`):
  - `class ChatError extends Error`
  - `runChatTurn(args: { client: LlmClient; model: string; systemPrompt: string; history: ChatMessage[]; userMessage: string }): Promise<{ reply: string; truncated: boolean; usage: Usage }>`

- [ ] **Step 1: Failing tests**

`packages/core/src/chat/runChatTurn.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { runChatTurn, ChatError } from './runChatTurn'
import type { LlmClient } from '../llm/index'

function fakeClient(content: { type: string; text?: string }[], stop = 'end_turn') {
  const create = vi.fn().mockResolvedValue({ content, stop_reason: stop, usage: { input_tokens: 300, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 900 } })
  return { client: { messages: { create, parse: vi.fn() } } as unknown as LlmClient, create }
}
const history = [
  { role: 'user' as const, content: 'hi', at: '2026-09-20T10:00:00.000Z' },
  { role: 'assistant' as const, content: 'hello', at: '2026-09-20T10:00:01.000Z' },
]

describe('runChatTurn', () => {
  it('passes history in order, appends the new user message, joins text blocks', async () => {
    const { client, create } = fakeClient([{ type: 'text', text: 'Part 1' }, { type: 'text', text: 'Part 2' }])
    const out = await runChatTurn({ client, model: 'global.anthropic.claude-haiku-4-5-20251001-v1:0', systemPrompt: 'S', history, userMessage: 'draft' })
    const params = create.mock.calls[0]![0]
    expect(params.messages).toEqual([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: 'draft' }])
    expect(params.system).toEqual([{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }])
    expect(params.thinking).toBeUndefined()
    expect(out).toEqual({ reply: 'Part 1\nPart 2', truncated: false, usage: { inputTokens: 1200, outputTokens: 120 } })
  })
  it('enables adaptive thinking for 4.6+ models and flags truncation', async () => {
    const { client, create } = fakeClient([{ type: 'text', text: 'cut' }], 'max_tokens')
    const out = await runChatTurn({ client, model: 'anthropic.claude-sonnet-5', systemPrompt: 'S', history: [], userMessage: 'x' })
    expect(create.mock.calls[0]![0].thinking).toEqual({ type: 'adaptive' })
    expect(out.truncated).toBe(true)
  })
  it('throws ChatError on empty reply', async () => {
    const { client } = fakeClient([])
    await expect(runChatTurn({ client, model: 'm', systemPrompt: 'S', history: [], userMessage: 'x' })).rejects.toBeInstanceOf(ChatError)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gighunter/core test -- chat`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`packages/core/src/chat/runChatTurn.ts`:
```ts
import type Anthropic from '@anthropic-ai/sdk'
import { supportsAdaptiveThinking, usageFrom, type CreateParams, type LlmClient } from '../llm/index'
import type { ChatMessage, Usage } from '../schema/index'

export class ChatError extends Error {
  constructor(message: string) { super(message); this.name = 'ChatError' }
}

export async function runChatTurn(args: {
  client: LlmClient
  model: string
  systemPrompt: string
  history: ChatMessage[]
  userMessage: string
}): Promise<{ reply: string; truncated: boolean; usage: Usage }> {
  const messages: Anthropic.MessageParam[] = [
    ...args.history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: args.userMessage },
  ]
  const params: CreateParams = {
    model: args.model,
    max_tokens: 4096,
    system: [{ type: 'text', text: args.systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages,
  }
  if (supportsAdaptiveThinking(args.model)) params.thinking = { type: 'adaptive' }

  const res = await args.client.messages.create(params)
  const reply = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
  if (!reply) throw new ChatError(`model returned no text (stop_reason=${res.stop_reason})`)
  return { reply, truncated: res.stop_reason === 'max_tokens', usage: usageFrom(res.usage) }
}
```

`packages/core/src/chat/index.ts`: `export * from './runChatTurn'`
Append to `packages/core/src/index.ts`: `export * from './chat/index'`

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @gighunter/core test -- chat && pnpm --filter @gighunter/core typecheck`
Expected: pass. If `thinking: { type: 'adaptive' }` fails typecheck against the installed SDK types, widen the assignment: `(params as Record<string, unknown>).thinking = { type: 'adaptive' }` and leave a comment pointing at spec §9.2.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): per-job chat turn runner"
```

---

### Task 8: Telegram client and message formatting

**Files:**
- Create: `packages/core/src/notifier/{format.ts,telegram.ts,index.ts}`, `packages/core/src/notifier/format.test.ts`, `packages/core/src/notifier/telegram.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Match`, `Job`, `Feedback`, `Platform` (Task 2)
- Produces (`@gighunter/core/notifier`):
  - `type InlineKeyboard = { inline_keyboard: { text: string; callback_data: string }[][] }`
  - `escapeHtml(s: string): string`
  - `feedbackCallbackData(ref: MatchRef, feedback: Feedback): string` (`fb:<platform>:<externalId>:<up|down>`, throws if > 64 bytes)
  - `parseFeedbackCallbackData(data: string): { platform: Platform; externalId: string; feedback: Feedback } | null`
  - `feedbackKeyboard(ref: MatchRef): InlineKeyboard`, `feedbackChosenKeyboard(feedback: Feedback): InlineKeyboard`
  - `formatMatchMessage(match: Match, appUrl: string): { text: string; replyMarkup: InlineKeyboard }`
  - `type FetchFn = typeof fetch`
  - `class TelegramError extends Error { code?: number; description?: string }`
  - `class TelegramClient { constructor(token: string, fetchFn?: FetchFn, baseUrl?: string); getMe(); setWebhook(url, secretToken, allowedUpdates); deleteWebhook(); sendMessage(chatId, text, replyMarkup?) → { messageId }; answerCallbackQuery(id, text?); editMessageReplyMarkup(chatId, messageId, replyMarkup) }`

- [ ] **Step 1: Failing tests**

`packages/core/src/notifier/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { formatMatchMessage, feedbackCallbackData, parseFeedbackCallbackData, feedbackChosenKeyboard, escapeHtml } from './format'
import { SAMPLE_MATCH } from '../prompts'

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
```

`packages/core/src/notifier/telegram.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { TelegramClient, TelegramError } from './telegram'

const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'content-type': 'application/json' } })
const fail = (status: number, description: string) =>
  new Response(JSON.stringify({ ok: false, error_code: status, description }), { status, headers: { 'content-type': 'application/json' } })

describe('TelegramClient', () => {
  it('posts JSON to the bot method URL and unwraps result', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok({ id: 1, username: 'gh_bot', is_bot: true }))
    const tg = new TelegramClient('123:ABC', fetchFn)
    expect(await tg.getMe()).toEqual({ id: 1, username: 'gh_bot' })
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('https://api.telegram.org/bot123:ABC/getMe')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' })
  })
  it('sendMessage returns message id and passes parse_mode + reply_markup', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok({ message_id: 42 }))
    const tg = new TelegramClient('t', fetchFn)
    const kb = { inline_keyboard: [[{ text: 'x', callback_data: 'noop' }]] }
    expect(await tg.sendMessage('-100', '<b>hi</b>', kb)).toEqual({ messageId: 42 })
    const body = JSON.parse(fetchFn.mock.calls[0]![1].body)
    expect(body).toEqual({ chat_id: '-100', text: '<b>hi</b>', parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: kb })
  })
  it('setWebhook sends url, secret_token and allowed_updates', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok(true))
    await new TelegramClient('t', fetchFn).setWebhook('https://api/x', 'sec', ['message'])
    expect(JSON.parse(fetchFn.mock.calls[0]![1].body)).toEqual({ url: 'https://api/x', secret_token: 'sec', allowed_updates: ['message'] })
  })
  it('maps ok:false to TelegramError without leaking the token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(fail(401, 'Unauthorized'))
    const err = await new TelegramClient('SECRET_TOKEN', fetchFn).getMe().catch((e) => e)
    expect(err).toBeInstanceOf(TelegramError)
    expect(err.code).toBe(401)
    expect(err.message).toContain('Unauthorized')
    expect(err.message).not.toContain('SECRET_TOKEN')
  })
  it('maps network failures to TelegramError', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    await expect(new TelegramClient('t', fetchFn).deleteWebhook()).rejects.toBeInstanceOf(TelegramError)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gighunter/core test -- notifier`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement**

`packages/core/src/notifier/format.ts`:
```ts
import { FeedbackSchema, PlatformSchema, type Feedback, type Match, type MatchRef, type Platform } from '../schema'

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
  const range = b.min !== undefined && b.max !== undefined ? `$${b.min}–${b.max}` : b.min !== undefined ? `from $${b.min}` : b.max !== undefined ? `up to $${b.max}` : '$?'
  return b.type === 'hourly' ? `${range}/h ${b.currency} hourly` : `${range} ${b.currency} fixed`
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
```

`packages/core/src/notifier/telegram.ts`:
```ts
import type { InlineKeyboard } from './format'

export type FetchFn = typeof fetch

export class TelegramError extends Error {
  constructor(message: string, readonly code?: number, readonly description?: string) {
    super(message)
    this.name = 'TelegramError'
  }
}

interface ApiEnvelope<T> { ok: boolean; result?: T; description?: string; error_code?: number }

export class TelegramClient {
  constructor(
    private readonly token: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly baseUrl = 'https://api.telegram.org',
  ) {}

  private async call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    let res: Response
    try {
      res = await this.fetchFn(`${this.baseUrl}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (e) {
      throw new TelegramError(`telegram ${method}: network error: ${(e as Error).message}`)
    }
    let json: ApiEnvelope<T> | undefined
    try { json = (await res.json()) as ApiEnvelope<T> } catch { /* non-JSON body */ }
    if (!res.ok || !json?.ok) {
      throw new TelegramError(`telegram ${method} failed: ${json?.description ?? `HTTP ${res.status}`}`, json?.error_code ?? res.status, json?.description)
    }
    return json.result as T
  }

  async getMe(): Promise<{ id: number; username: string }> {
    const me = await this.call<{ id: number; username: string }>('getMe')
    return { id: me.id, username: me.username }
  }

  async setWebhook(url: string, secretToken: string, allowedUpdates: string[]): Promise<void> {
    await this.call('setWebhook', { url, secret_token: secretToken, allowed_updates: allowedUpdates })
  }

  async deleteWebhook(): Promise<void> {
    await this.call('deleteWebhook')
  }

  async sendMessage(chatId: string, text: string, replyMarkup?: InlineKeyboard): Promise<{ messageId: number }> {
    const r = await this.call<{ message_id: number }>('sendMessage', {
      chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    })
    return { messageId: r.message_id }
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) })
  }

  async editMessageReplyMarkup(chatId: string, messageId: number, replyMarkup: InlineKeyboard): Promise<void> {
    await this.call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: replyMarkup })
  }
}
```

`packages/core/src/notifier/index.ts`:
```ts
export * from './format'
export * from './telegram'
```
Append to `packages/core/src/index.ts`: `export * from './notifier/index'`

- [ ] **Step 4: Run tests + typecheck; review the snapshot file**

Run: `pnpm --filter @gighunter/core test -- notifier && pnpm --filter @gighunter/core typecheck`
Expected: pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): Telegram client and match message formatter"
```

---

### Task 9: DynamoDB store

**Files:**
- Create: `packages/core/src/store/{keys.ts,store.ts,index.ts}`, `packages/core/src/store/keys.test.ts`, `packages/core/src/store/store.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: schemas (Task 2)
- Produces (`@gighunter/core/store`):
  - keys: `userPk(userId)`, `SK = { profile, settings, prompts }`, `matchKey(ref)` (`platform#externalId`), `matchSk(ref)`, `chatSk(ref)`, `runSk(startedAt)`, `ACTIVE_USER_GSI1PK`, `matchGsi2pk(userId, status)`, `GSI1 = 'gsi1'`, `GSI2 = 'gsi2'`, `ttlAfterDays(iso, days)`, `MATCH_TTL_DAYS = 60`, `RUN_TTL_DAYS = 30`, `CHAT_TTL_DAYS = 60`
  - `interface MatchPage { items: Match[]; cursor?: string }`
  - `class Store` with methods: `getProfile`, `putProfile`, `getSettings`, `putSettings`, `getPrompts`, `putPrompts`, `listActiveUsers`, `getMatch`, `existingMatchKeys`, `putMatch`, `updateMatchStatus`, `setMatchFeedback`, `listMatches`, `putRun`, `listRuns`, `getChat`, `putChat`, `deleteChat` (signatures in the implementation below)

- [ ] **Step 1: Failing tests**

`packages/core/src/store/keys.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { userPk, matchSk, chatSk, runSk, matchGsi2pk, ttlAfterDays, matchKey } from './keys'

describe('keys', () => {
  it('builds the documented key shapes', () => {
    expect(userPk('abc')).toBe('USER#abc')
    expect(matchKey({ platform: 'freelancer', externalId: '1' })).toBe('freelancer#1')
    expect(matchSk({ platform: 'freelancer', externalId: '1' })).toBe('MATCH#freelancer#1')
    expect(chatSk({ platform: 'upwork', externalId: '~x' })).toBe('CHAT#upwork#~x')
    expect(runSk('2026-09-20T10:00:00.000Z')).toBe('RUN#2026-09-20T10:00:00.000Z')
    expect(matchGsi2pk('abc', 'pending')).toBe('USER#abc#pending')
  })
  it('ttlAfterDays is epoch seconds', () => {
    expect(ttlAfterDays('2026-09-20T00:00:00.000Z', 1)).toBe(Math.floor(Date.parse('2026-09-21T00:00:00.000Z') / 1000))
  })
})
```

`packages/core/src/store/store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, BatchGetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'
import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { Store } from './store'
import { defaultSettings } from '../schema'
import { SAMPLE_MATCH } from '../prompts'

const ddb = mockClient(DynamoDBDocumentClient)
const store = new Store(DynamoDBDocumentClient.from(new DynamoDBClient({})), 'tbl')
const now = '2026-09-20T10:00:00.000Z'

beforeEach(() => ddb.reset())

describe('settings + active users', () => {
  it('putSettings writes gsi1 keys only when active', async () => {
    ddb.on(PutCommand).resolves({})
    await store.putSettings('u1', { ...defaultSettings(now), active: true })
    expect(ddb.commandCalls(PutCommand)[0]!.args[0].input.Item).toMatchObject({ pk: 'USER#u1', sk: 'SETTINGS', gsi1pk: 'ACTIVE_USER', gsi1sk: 'u1', active: true })
    await store.putSettings('u2', defaultSettings(now))
    expect(ddb.commandCalls(PutCommand)[1]!.args[0].input.Item).not.toHaveProperty('gsi1pk')
  })
  it('getSettings strips internal keys and parses defaults', async () => {
    ddb.on(GetCommand).resolves({ Item: { pk: 'USER#u1', sk: 'SETTINGS', gsi1pk: 'ACTIVE_USER', active: true, updatedAt: now } })
    const s = await store.getSettings('u1')
    expect(s).not.toHaveProperty('pk')
    expect(s?.notifyThreshold).toBe(70)
    ddb.on(GetCommand).resolves({})
    expect(await store.getSettings('nobody')).toBeNull()
  })
  it('listActiveUsers queries gsi1 and follows pagination', async () => {
    ddb.on(QueryCommand).resolvesOnce({ Items: [{ gsi1sk: 'a' }], LastEvaluatedKey: { x: 1 } }).resolvesOnce({ Items: [{ gsi1sk: 'b' }] })
    expect(await store.listActiveUsers()).toEqual(['a', 'b'])
    expect(ddb.commandCalls(QueryCommand)[0]!.args[0].input).toMatchObject({ IndexName: 'gsi1', ExpressionAttributeValues: { ':p': 'ACTIVE_USER' } })
  })
})

describe('matches', () => {
  it('putMatch sets gsi2 keys from status and postedAt', async () => {
    ddb.on(PutCommand).resolves({})
    await store.putMatch('u1', SAMPLE_MATCH)
    expect(ddb.commandCalls(PutCommand)[0]!.args[0].input.Item).toMatchObject({
      pk: 'USER#u1', sk: 'MATCH#freelancer#sample-1', gsi2pk: 'USER#u1#notified', gsi2sk: SAMPLE_MATCH.job.postedAt, status: 'notified',
    })
  })
  it('existingMatchKeys batches by 100 and returns platform#id keys', async () => {
    const refs = Array.from({ length: 150 }, (_, i) => ({ platform: 'freelancer' as const, externalId: String(i) }))
    ddb.on(BatchGetCommand).resolvesOnce({ Responses: { tbl: [{ sk: 'MATCH#freelancer#3' }] } }).resolvesOnce({ Responses: { tbl: [{ sk: 'MATCH#freelancer#120' }] } })
    const keys = await store.existingMatchKeys('u1', refs)
    expect([...keys]).toEqual(['freelancer#3', 'freelancer#120'])
    expect(ddb.commandCalls(BatchGetCommand)).toHaveLength(2)
    expect(ddb.commandCalls(BatchGetCommand)[0]!.args[0].input.RequestItems!.tbl!.Keys).toHaveLength(100)
  })
  it('updateMatchStatus rewrites gsi2pk and optional delivery fields', async () => {
    ddb.on(UpdateCommand).resolves({})
    await store.updateMatchStatus('u1', { platform: 'freelancer', externalId: '1' }, { status: 'notified', telegramMessageId: 7, notifiedAt: now })
    const input = ddb.commandCalls(UpdateCommand)[0]!.args[0].input
    expect(input.UpdateExpression).toBe('SET #status = :status, gsi2pk = :gsi2pk, telegramMessageId = :telegramMessageId, notifiedAt = :notifiedAt')
    expect(input.ExpressionAttributeValues).toEqual({ ':status': 'notified', ':gsi2pk': 'USER#u1#notified', ':telegramMessageId': 7, ':notifiedAt': now })
  })
  it('setMatchFeedback returns the updated match or null when missing', async () => {
    ddb.on(UpdateCommand).resolvesOnce({ Attributes: { pk: 'x', sk: 'y', ...SAMPLE_MATCH, feedback: 'up', feedbackAt: now } })
    const m = await store.setMatchFeedback('u1', { platform: 'freelancer', externalId: 'sample-1' }, 'up', now)
    expect(m?.feedback).toBe('up')
    ddb.on(UpdateCommand).rejectsOnce(new ConditionalCheckFailedException({ message: 'no', $metadata: {} }))
    expect(await store.setMatchFeedback('u1', { platform: 'freelancer', externalId: 'zzz' }, 'up', now)).toBeNull()
  })
  it('listMatches queries gsi2 newest-first and round-trips the cursor', async () => {
    ddb.on(QueryCommand).resolvesOnce({ Items: [{ pk: 'p', sk: 's', ...SAMPLE_MATCH }], LastEvaluatedKey: { pk: 'p', sk: 's', gsi2pk: 'g', gsi2sk: 't' } })
    const page = await store.listMatches('u1', 'notified', { limit: 1 })
    expect(page.items[0]!.job.externalId).toBe('sample-1')
    expect(page.cursor).toBeTruthy()
    const q = ddb.commandCalls(QueryCommand)[0]!.args[0].input
    expect(q).toMatchObject({ IndexName: 'gsi2', ScanIndexForward: false, Limit: 1, ExpressionAttributeValues: { ':p': 'USER#u1#notified' } })
    ddb.on(QueryCommand).resolvesOnce({ Items: [] })
    await store.listMatches('u1', 'notified', { cursor: page.cursor })
    expect(ddb.commandCalls(QueryCommand)[1]!.args[0].input.ExclusiveStartKey).toEqual({ pk: 'p', sk: 's', gsi2pk: 'g', gsi2sk: 't' })
  })
})

describe('runs + chat', () => {
  it('listRuns queries RUN# prefix descending', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] })
    await store.listRuns('u1', 5)
    expect(ddb.commandCalls(QueryCommand)[0]!.args[0].input).toMatchObject({
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': 'USER#u1', ':prefix': 'RUN#' }, ScanIndexForward: false, Limit: 5,
    })
  })
  it('deleteChat deletes by key', async () => {
    ddb.on(DeleteCommand).resolves({})
    await store.deleteChat('u1', { platform: 'freelancer', externalId: '1' })
    expect(ddb.commandCalls(DeleteCommand)[0]!.args[0].input.Key).toEqual({ pk: 'USER#u1', sk: 'CHAT#freelancer#1' })
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gighunter/core test -- store`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement**

`packages/core/src/store/keys.ts`:
```ts
import type { MatchRef, MatchStatus } from '../schema'

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
```

`packages/core/src/store/store.ts`:
```ts
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { BatchGetCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import {
  ChatSchema, MatchSchema, ProfileSchema, PromptsSchema, RunSchema, SettingsSchema,
  type Chat, type Feedback, type Match, type MatchRef, type MatchStatus, type Profile, type Prompts, type Run, type Settings,
} from '../schema'
import { ACTIVE_USER_GSI1PK, GSI1, GSI2, SK, chatSk, matchGsi2pk, matchSk, runSk, userPk } from './keys'

type Item = Record<string, unknown>
const INTERNAL_KEYS = ['pk', 'sk', 'gsi1pk', 'gsi1sk', 'gsi2pk', 'gsi2sk'] as const

function strip(item: Item): Item {
  const out: Item = { ...item }
  for (const k of INTERNAL_KEYS) delete out[k]
  return out
}
const encodeCursor = (key: Item | undefined) => (key ? Buffer.from(JSON.stringify(key)).toString('base64url') : undefined)
const decodeCursor = (cursor: string | undefined): Item | undefined => (cursor ? (JSON.parse(Buffer.from(cursor, 'base64url').toString()) as Item) : undefined)

export interface MatchPage { items: Match[]; cursor?: string }
export interface MatchStatusPatch { status: MatchStatus; telegramMessageId?: number; notifiedAt?: string }

export class Store {
  constructor(private readonly doc: DynamoDBDocumentClient, private readonly tableName: string) {}

  private async getItem(pk: string, sk: string): Promise<Item | null> {
    const r = await this.doc.send(new GetCommand({ TableName: this.tableName, Key: { pk, sk } }))
    return r.Item ? strip(r.Item) : null
  }
  private async putItem(item: Item): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.tableName, Item: item }))
  }

  // --- profile / settings / prompts -------------------------------------------------
  async getProfile(userId: string): Promise<Profile | null> {
    const i = await this.getItem(userPk(userId), SK.profile)
    return i ? ProfileSchema.parse(i) : null
  }
  async putProfile(userId: string, profile: Profile): Promise<void> {
    await this.putItem({ pk: userPk(userId), sk: SK.profile, ...profile })
  }
  async getSettings(userId: string): Promise<Settings | null> {
    const i = await this.getItem(userPk(userId), SK.settings)
    return i ? SettingsSchema.parse(i) : null
  }
  async putSettings(userId: string, settings: Settings): Promise<void> {
    const gsi = settings.active ? { gsi1pk: ACTIVE_USER_GSI1PK, gsi1sk: userId } : {}
    await this.putItem({ pk: userPk(userId), sk: SK.settings, ...gsi, ...settings })
  }
  async getPrompts(userId: string): Promise<Prompts | null> {
    const i = await this.getItem(userPk(userId), SK.prompts)
    return i ? PromptsSchema.parse(i) : null
  }
  async putPrompts(userId: string, prompts: Prompts): Promise<void> {
    await this.putItem({ pk: userPk(userId), sk: SK.prompts, ...prompts })
  }

  // --- users ------------------------------------------------------------------------
  async listActiveUsers(): Promise<string[]> {
    const users: string[] = []
    let ExclusiveStartKey: Item | undefined
    do {
      const r = await this.doc.send(new QueryCommand({
        TableName: this.tableName, IndexName: GSI1,
        KeyConditionExpression: 'gsi1pk = :p', ExpressionAttributeValues: { ':p': ACTIVE_USER_GSI1PK },
        ProjectionExpression: 'gsi1sk', ExclusiveStartKey,
      }))
      for (const i of r.Items ?? []) users.push(String(i.gsi1sk))
      ExclusiveStartKey = r.LastEvaluatedKey
    } while (ExclusiveStartKey)
    return users
  }

  // --- matches ----------------------------------------------------------------------
  async getMatch(userId: string, ref: MatchRef): Promise<Match | null> {
    const i = await this.getItem(userPk(userId), matchSk(ref))
    return i ? MatchSchema.parse(i) : null
  }

  /** Returns the subset of refs that already exist, as `platform#externalId` strings. */
  async existingMatchKeys(userId: string, refs: MatchRef[]): Promise<Set<string>> {
    const found = new Set<string>()
    for (let i = 0; i < refs.length; i += 100) {
      let keys: Item[] = refs.slice(i, i + 100).map((ref) => ({ pk: userPk(userId), sk: matchSk(ref) }))
      while (keys.length) {
        const r = await this.doc.send(new BatchGetCommand({
          RequestItems: { [this.tableName]: { Keys: keys, ProjectionExpression: 'sk' } },
        }))
        for (const item of r.Responses?.[this.tableName] ?? []) found.add(String(item.sk).slice('MATCH#'.length))
        keys = (r.UnprocessedKeys?.[this.tableName]?.Keys as Item[] | undefined) ?? []
      }
    }
    return found
  }

  async putMatch(userId: string, match: Match): Promise<void> {
    const ref = { platform: match.job.platform, externalId: match.job.externalId }
    await this.putItem({ pk: userPk(userId), sk: matchSk(ref), gsi2pk: matchGsi2pk(userId, match.status), gsi2sk: match.job.postedAt, ...match })
  }

  async updateMatchStatus(userId: string, ref: MatchRef, patch: MatchStatusPatch): Promise<void> {
    const sets = ['#status = :status', 'gsi2pk = :gsi2pk']
    const values: Item = { ':status': patch.status, ':gsi2pk': matchGsi2pk(userId, patch.status) }
    if (patch.telegramMessageId !== undefined) { sets.push('telegramMessageId = :telegramMessageId'); values[':telegramMessageId'] = patch.telegramMessageId }
    if (patch.notifiedAt !== undefined) { sets.push('notifiedAt = :notifiedAt'); values[':notifiedAt'] = patch.notifiedAt }
    await this.doc.send(new UpdateCommand({
      TableName: this.tableName, Key: { pk: userPk(userId), sk: matchSk(ref) },
      UpdateExpression: `SET ${sets.join(', ')}`, ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: values,
    }))
  }

  async setMatchFeedback(userId: string, ref: MatchRef, feedback: Feedback, at: string): Promise<Match | null> {
    try {
      const r = await this.doc.send(new UpdateCommand({
        TableName: this.tableName, Key: { pk: userPk(userId), sk: matchSk(ref) },
        UpdateExpression: 'SET feedback = :f, feedbackAt = :at', ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeValues: { ':f': feedback, ':at': at }, ReturnValues: 'ALL_NEW',
      }))
      return r.Attributes ? MatchSchema.parse(strip(r.Attributes)) : null
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) return null
      throw e
    }
  }

  async listMatches(userId: string, status: MatchStatus, opts: { limit?: number; cursor?: string } = {}): Promise<MatchPage> {
    const r = await this.doc.send(new QueryCommand({
      TableName: this.tableName, IndexName: GSI2,
      KeyConditionExpression: 'gsi2pk = :p', ExpressionAttributeValues: { ':p': matchGsi2pk(userId, status) },
      ScanIndexForward: false, Limit: opts.limit ?? 50, ExclusiveStartKey: decodeCursor(opts.cursor),
    }))
    return { items: (r.Items ?? []).map((i) => MatchSchema.parse(strip(i))), cursor: encodeCursor(r.LastEvaluatedKey) }
  }

  // --- runs -------------------------------------------------------------------------
  async putRun(userId: string, run: Run): Promise<void> {
    await this.putItem({ pk: userPk(userId), sk: runSk(run.startedAt), ...run })
  }
  async listRuns(userId: string, limit = 10): Promise<Run[]> {
    const r = await this.doc.send(new QueryCommand({
      TableName: this.tableName, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':pk': userPk(userId), ':prefix': 'RUN#' }, ScanIndexForward: false, Limit: limit,
    }))
    return (r.Items ?? []).map((i) => RunSchema.parse(strip(i)))
  }

  // --- chat -------------------------------------------------------------------------
  async getChat(userId: string, ref: MatchRef): Promise<Chat | null> {
    const i = await this.getItem(userPk(userId), chatSk(ref))
    return i ? ChatSchema.parse(i) : null
  }
  async putChat(userId: string, ref: MatchRef, chat: Chat): Promise<void> {
    await this.putItem({ pk: userPk(userId), sk: chatSk(ref), ...chat })
  }
  async deleteChat(userId: string, ref: MatchRef): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.tableName, Key: { pk: userPk(userId), sk: chatSk(ref) } }))
  }
}
```

`packages/core/src/store/index.ts`:
```ts
export * from './keys'
export * from './store'
```
Append to `packages/core/src/index.ts`: `export * from './store/index'`

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @gighunter/core test -- store && pnpm --filter @gighunter/core typecheck`
Expected: pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): single-table DynamoDB store with user-scoped keys"
```

---

### Task 10: SSM secrets

**Files:**
- Create: `packages/core/src/secrets/{secrets.ts,index.ts}`, `packages/core/src/secrets/secrets.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces (`@gighunter/core/secrets`):
  - `type UserSecretName = 'telegram/bot-token' | 'freelancer/token'`
  - `class Secrets { constructor(ssm: SSMClient, prefix = '/gighunter'); userParamName(userId, name): string; getUserSecret(userId, name): Promise<string | null>; putUserSecret(userId, name, value): Promise<void>; deleteUserSecret(userId, name): Promise<void>; getAllowedEmails(): Promise<string[]> }`

- [ ] **Step 1: Failing tests**

`packages/core/src/secrets/secrets.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { SSMClient, GetParameterCommand, PutParameterCommand, DeleteParameterCommand, ParameterNotFound } from '@aws-sdk/client-ssm'
import { Secrets } from './secrets'

const ssm = mockClient(SSMClient)
const secrets = new Secrets(new SSMClient({}))
beforeEach(() => ssm.reset())

describe('Secrets', () => {
  it('builds parameter names under the prefix', () => {
    expect(secrets.userParamName('u1', 'telegram/bot-token')).toBe('/gighunter/users/u1/telegram/bot-token')
  })
  it('getUserSecret decrypts and returns null when missing', async () => {
    ssm.on(GetParameterCommand).resolvesOnce({ Parameter: { Value: 'tok' } })
    expect(await secrets.getUserSecret('u1', 'freelancer/token')).toBe('tok')
    expect(ssm.commandCalls(GetParameterCommand)[0]!.args[0].input).toEqual({ Name: '/gighunter/users/u1/freelancer/token', WithDecryption: true })
    ssm.on(GetParameterCommand).rejectsOnce(new ParameterNotFound({ message: 'nope', $metadata: {} }))
    expect(await secrets.getUserSecret('u1', 'freelancer/token')).toBeNull()
  })
  it('putUserSecret writes a SecureString with overwrite', async () => {
    ssm.on(PutParameterCommand).resolves({})
    await secrets.putUserSecret('u1', 'telegram/bot-token', '123:abc')
    expect(ssm.commandCalls(PutParameterCommand)[0]!.args[0].input).toEqual({ Name: '/gighunter/users/u1/telegram/bot-token', Value: '123:abc', Type: 'SecureString', Overwrite: true })
  })
  it('deleteUserSecret ignores missing parameters', async () => {
    ssm.on(DeleteParameterCommand).rejectsOnce(new ParameterNotFound({ message: 'nope', $metadata: {} }))
    await expect(secrets.deleteUserSecret('u1', 'telegram/bot-token')).resolves.toBeUndefined()
  })
  it('getAllowedEmails splits, trims and lowercases', async () => {
    ssm.on(GetParameterCommand).resolvesOnce({ Parameter: { Value: ' A@x.com, b@y.com ,' } })
    expect(await secrets.getAllowedEmails()).toEqual(['a@x.com', 'b@y.com'])
    ssm.on(GetParameterCommand).rejectsOnce(new ParameterNotFound({ message: 'nope', $metadata: {} }))
    expect(await secrets.getAllowedEmails()).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gighunter/core test -- secrets`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`packages/core/src/secrets/secrets.ts`:
```ts
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
```

`packages/core/src/secrets/index.ts`: `export * from './secrets'`
Append to `packages/core/src/index.ts`: `export * from './secrets/index'`

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @gighunter/core test -- secrets && pnpm --filter @gighunter/core typecheck`
Expected: pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): SSM-backed secrets accessor"
```

---

### Task 11: Job source adapters (Freelancer.com + Upwork stub)

**Files:**
- Create: `packages/core/src/adapters/{types.ts,index.ts}`, `packages/core/src/adapters/freelancer/{source.ts,normalize.ts}`, `packages/core/src/adapters/freelancer/__fixtures__/projects-active.json`, `packages/core/src/adapters/freelancer/source.test.ts`, `packages/core/src/adapters/upwork/source.ts`, `packages/core/src/adapters/registry.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Job`, `Platform`, `Settings` (Task 2); `FetchFn` (Task 8)
- Produces (`@gighunter/core/adapters`):
  - `interface JobSource { readonly platform: Platform; fetchRecent(p: { query: string; since: Date; token: string }): Promise<Job[]>; verifyToken(token: string): Promise<{ ok: true; username: string } | { ok: false; error: string }> }`
  - `class SourceError extends Error { code: string; retryAfterSec?: number }`
  - `class FreelancerSource implements JobSource`, `normalizeFreelancerProject(project, users): Job`
  - `class UpworkSource implements JobSource`
  - `createSources(fetchFn?: FetchFn): Record<Platform, JobSource>`
  - `enabledPlatforms(settings: Settings): Platform[]`

- [ ] **Step 1: Fixture**

`packages/core/src/adapters/freelancer/__fixtures__/projects-active.json` — shaped like the Freelancer API 0.1 `projects/active` response (refresh it with `pnpm freelancer:probe --save-fixture` in Task 20 once a token exists):
```json
{
  "status": "success",
  "result": {
    "projects": [
      {
        "id": 39876543,
        "owner_id": 12345678,
        "title": "Fix Stripe webhook retries in Next.js app",
        "status": "active",
        "seo_url": "nextjs/Fix-Stripe-webhook-retries-39876543",
        "currency": { "id": 1, "code": "USD", "sign": "$" },
        "description": "Our Next.js 14 app double-processes Stripe webhook events after retries. Need idempotency keys in Postgres (Prisma) and a small test.",
        "jobs": [{ "id": 1, "name": "Next.js" }, { "id": 2, "name": "Stripe" }],
        "submitdate": 1789896000,
        "time_updated": 1789896000,
        "type": "fixed",
        "budget": { "minimum": 150, "maximum": 300 },
        "language": "en"
      },
      {
        "id": 39876544,
        "owner_id": 22222222,
        "title": "Ongoing React developer",
        "status": "active",
        "seo_url": "react/Ongoing-React-developer-39876544",
        "currency": { "id": 1, "code": "USD", "sign": "$" },
        "description": "Need a React developer for ongoing work, 20h/week.",
        "jobs": [{ "id": 3, "name": "React" }],
        "submitdate": 1789897000,
        "time_updated": 1789897000,
        "type": "hourly",
        "budget": { "minimum": 15, "maximum": 25 },
        "language": "en"
      }
    ],
    "users": {
      "12345678": {
        "id": 12345678, "username": "acme_inc",
        "location": { "country": { "name": "United States", "code": "us" } },
        "status": { "payment_verified": true },
        "employer_reputation": { "entire_history": { "overall": 4.8, "reviews": 12 } }
      },
      "22222222": {
        "id": 22222222, "username": "newbie",
        "location": { "country": { "name": "Germany", "code": "de" } },
        "status": { "payment_verified": false },
        "employer_reputation": { "entire_history": { "overall": 0, "reviews": 0 } }
      }
    },
    "total_count": 2
  },
  "request_id": "fixture"
}
```

- [ ] **Step 2: Failing tests**

`packages/core/src/adapters/freelancer/source.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { FreelancerSource } from './source'
import { SourceError } from '../types'
import fixture from './__fixtures__/projects-active.json'

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

describe('FreelancerSource.fetchRecent', () => {
  it('calls the active projects endpoint with auth header and normalizes', async () => {
    const fetchFn = vi.fn().mockResolvedValue(json(fixture))
    const src = new FreelancerSource(fetchFn)
    const jobs = await src.fetchRecent({ query: 'react', since: new Date('2026-09-20T00:00:00Z'), token: 'TOK' })
    const [url, init] = fetchFn.mock.calls[0]!
    expect(String(url)).toMatch(/^https:\/\/www\.freelancer\.com\/api\/projects\/0\.1\/projects\/active\/\?/)
    expect(String(url)).toContain('query=react')
    expect(String(url)).toContain('from_time=1789862400')
    expect(init.headers).toMatchObject({ 'freelancer-oauth-v1': 'TOK' })
    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toMatchObject({
      platform: 'freelancer', externalId: '39876543', url: 'https://www.freelancer.com/projects/nextjs/Fix-Stripe-webhook-retries-39876543',
      title: 'Fix Stripe webhook retries in Next.js app', budget: { min: 150, max: 300, currency: 'USD', type: 'fixed' },
      skills: ['Next.js', 'Stripe'], postedAt: '2026-09-20T09:20:00.000Z', language: 'en',
      client: { country: 'United States', rating: 4.8, reviews: 12, paymentVerified: true },
    })
    expect(jobs[1]!.budget).toEqual({ min: 15, max: 25, currency: 'USD', type: 'hourly' })
  })
  it('throws SourceError rate_limited with retryAfter on 429', async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ status: 'error' }, 429, { 'retry-after': '30' }))
    const err = await new FreelancerSource(fetchFn).fetchRecent({ query: '', since: new Date(), token: 't' }).catch((e) => e)
    expect(err).toBeInstanceOf(SourceError)
    expect(err.code).toBe('rate_limited')
    expect(err.retryAfterSec).toBe(30)
  })
  it('throws SourceError http_<status> on other failures', async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ status: 'error', message: 'bad token' }, 401))
    const err = await new FreelancerSource(fetchFn).fetchRecent({ query: '', since: new Date(), token: 't' }).catch((e) => e)
    expect(err.code).toBe('http_401')
  })
})

describe('FreelancerSource.verifyToken', () => {
  it('returns username on success and error otherwise', async () => {
    const okFetch = vi.fn().mockResolvedValue(json({ status: 'success', result: { id: 1, username: 'yev' } }))
    expect(await new FreelancerSource(okFetch).verifyToken('t')).toEqual({ ok: true, username: 'yev' })
    expect(String(okFetch.mock.calls[0]![0])).toBe('https://www.freelancer.com/api/users/0.1/self/')
    const badFetch = vi.fn().mockResolvedValue(json({ status: 'error', message: 'Unauthorized' }, 401))
    expect(await new FreelancerSource(badFetch).verifyToken('t')).toEqual({ ok: false, error: 'http_401' })
  })
})
```

`packages/core/src/adapters/registry.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createSources, enabledPlatforms, UpworkSource } from './index'
import { defaultSettings } from '../schema'

describe('registry', () => {
  it('createSources returns one adapter per platform', () => {
    const s = createSources()
    expect(s.freelancer.platform).toBe('freelancer')
    expect(s.upwork).toBeInstanceOf(UpworkSource)
  })
  it('enabledPlatforms requires enabled + tokenSet', () => {
    const base = defaultSettings('2026-09-20T10:00:00.000Z')
    expect(enabledPlatforms(base)).toEqual([])
    const on = { ...base, platforms: { ...base.platforms, freelancer: { ...base.platforms.freelancer, enabled: true, tokenSet: true } } }
    expect(enabledPlatforms(on)).toEqual(['freelancer'])
    const noToken = { ...base, platforms: { ...base.platforms, freelancer: { ...base.platforms.freelancer, enabled: true } } }
    expect(enabledPlatforms(noToken)).toEqual([])
  })
  it('upwork stub returns nothing and refuses tokens', async () => {
    const u = new UpworkSource()
    expect(await u.fetchRecent({ query: '', since: new Date(), token: '' })).toEqual([])
    expect(await u.verifyToken('x')).toEqual({ ok: false, error: 'not_implemented' })
  })
})
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter @gighunter/core test -- adapters`
Expected: FAIL — modules not found

- [ ] **Step 4: Implement**

`packages/core/src/adapters/types.ts`:
```ts
import type { Job, Platform } from '../schema'

export interface FetchRecentParams { query: string; since: Date; token: string }
export type VerifyResult = { ok: true; username: string } | { ok: false; error: string }

export interface JobSource {
  readonly platform: Platform
  fetchRecent(params: FetchRecentParams): Promise<Job[]>
  verifyToken(token: string): Promise<VerifyResult>
}

export class SourceError extends Error {
  constructor(message: string, readonly code: string, readonly retryAfterSec?: number) {
    super(message)
    this.name = 'SourceError'
  }
}
```

`packages/core/src/adapters/freelancer/normalize.ts`:
```ts
import { JobSchema, type Job } from '../../schema'

export interface FreelancerProject {
  id: number
  owner_id?: number
  title: string
  seo_url?: string
  currency?: { code?: string }
  description?: string
  preview_description?: string
  jobs?: { name: string }[]
  submitdate?: number
  time_updated?: number
  type?: string
  budget?: { minimum?: number | null; maximum?: number | null }
  language?: string
}

export interface FreelancerUser {
  location?: { country?: { name?: string } }
  status?: { payment_verified?: boolean }
  employer_reputation?: { entire_history?: { overall?: number; reviews?: number } }
}

export function normalizeFreelancerProject(p: FreelancerProject, users: Record<string, FreelancerUser>): Job {
  const owner = p.owner_id !== undefined ? users[String(p.owner_id)] : undefined
  const type = p.type === 'hourly' ? 'hourly' : 'fixed'
  const budget = p.budget
    ? {
        ...(p.budget.minimum != null ? { min: p.budget.minimum } : {}),
        ...(p.budget.maximum != null ? { max: p.budget.maximum } : {}),
        currency: p.currency?.code ?? 'USD',
        type,
      }
    : null
  const posted = p.submitdate ?? p.time_updated ?? Math.floor(Date.now() / 1000)
  return JobSchema.parse({
    platform: 'freelancer',
    externalId: String(p.id),
    url: p.seo_url ? `https://www.freelancer.com/projects/${p.seo_url}` : `https://www.freelancer.com/projects/${p.id}`,
    title: p.title,
    description: p.description ?? p.preview_description ?? '',
    budget,
    skills: (p.jobs ?? []).map((j) => j.name),
    postedAt: new Date(posted * 1000).toISOString(),
    ...(p.language ? { language: p.language } : {}),
    ...(owner
      ? {
          client: {
            ...(owner.location?.country?.name ? { country: owner.location.country.name } : {}),
            ...(owner.employer_reputation?.entire_history?.overall !== undefined ? { rating: owner.employer_reputation.entire_history.overall } : {}),
            ...(owner.employer_reputation?.entire_history?.reviews !== undefined ? { reviews: owner.employer_reputation.entire_history.reviews } : {}),
            ...(owner.status?.payment_verified !== undefined ? { paymentVerified: owner.status.payment_verified } : {}),
          },
        }
      : {}),
  })
}
```

`packages/core/src/adapters/freelancer/source.ts`:
```ts
import type { Job } from '../../schema'
import type { FetchFn } from '../../notifier'
import { SourceError, type FetchRecentParams, type JobSource, type VerifyResult } from '../types'
import { normalizeFreelancerProject, type FreelancerProject, type FreelancerUser } from './normalize'

interface ActiveProjectsResponse {
  status: string
  result?: { projects?: FreelancerProject[]; users?: Record<string, FreelancerUser> }
}

export class FreelancerSource implements JobSource {
  readonly platform = 'freelancer' as const

  constructor(private readonly fetchFn: FetchFn = fetch, private readonly baseUrl = 'https://www.freelancer.com/api') {}

  private async request<T>(path: string, token: string): Promise<T> {
    let res: Response
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, { headers: { 'freelancer-oauth-v1': token, accept: 'application/json' } })
    } catch (e) {
      throw new SourceError(`freelancer: network error: ${(e as Error).message}`, 'network')
    }
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') ?? '60')
      throw new SourceError('freelancer: rate limited', 'rate_limited', Number.isFinite(retry) ? retry : 60)
    }
    if (!res.ok) throw new SourceError(`freelancer: HTTP ${res.status}`, `http_${res.status}`)
    return (await res.json()) as T
  }

  async fetchRecent({ query, since, token }: FetchRecentParams): Promise<Job[]> {
    const params = new URLSearchParams({
      query,
      limit: '50',
      compact: 'true',
      job_details: 'true',
      user_details: 'true',
      full_description: 'true',
      sort_field: 'time_updated',
      from_time: String(Math.floor(since.getTime() / 1000)),
    })
    const body = await this.request<ActiveProjectsResponse>(`/projects/0.1/projects/active/?${params}`, token)
    const users = body.result?.users ?? {}
    return (body.result?.projects ?? []).map((p) => normalizeFreelancerProject(p, users))
  }

  async verifyToken(token: string): Promise<VerifyResult> {
    try {
      const body = await this.request<{ result?: { username?: string } }>('/users/0.1/self/', token)
      return body.result?.username ? { ok: true, username: body.result.username } : { ok: false, error: 'no_username' }
    } catch (e) {
      return { ok: false, error: e instanceof SourceError ? e.code : 'unknown' }
    }
  }
}
```

`packages/core/src/adapters/upwork/source.ts`:
```ts
import type { Job } from '../../schema'
import type { FetchRecentParams, JobSource, VerifyResult } from '../types'

/** Placeholder until an Upwork API key is granted (spec §7). */
export class UpworkSource implements JobSource {
  readonly platform = 'upwork' as const
  async fetchRecent(_: FetchRecentParams): Promise<Job[]> { return [] }
  async verifyToken(_: string): Promise<VerifyResult> { return { ok: false, error: 'not_implemented' } }
}
```

`packages/core/src/adapters/index.ts`:
```ts
import type { FetchFn } from '../notifier'
import type { Platform, Settings } from '../schema'
import { FreelancerSource } from './freelancer/source'
import { UpworkSource } from './upwork/source'
import type { JobSource } from './types'

export * from './types'
export { FreelancerSource } from './freelancer/source'
export { normalizeFreelancerProject } from './freelancer/normalize'
export { UpworkSource } from './upwork/source'

export function createSources(fetchFn: FetchFn = fetch): Record<Platform, JobSource> {
  return { freelancer: new FreelancerSource(fetchFn), upwork: new UpworkSource() }
}

export function enabledPlatforms(settings: Settings): Platform[] {
  const out: Platform[] = []
  const f = settings.platforms.freelancer
  if (f.enabled && f.tokenSet) out.push('freelancer')
  return out
}
```
Append to `packages/core/src/index.ts`: `export * from './adapters/index'`

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @gighunter/core test -- adapters && pnpm --filter @gighunter/core typecheck`
Expected: pass (the fixture's `submitdate` 1789896000 = `2026-09-20T09:20:00.000Z`; `since` 2026-09-20T00:00Z = 1789862400)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): job source interface, Freelancer.com adapter, Upwork stub"
```

---

### Task 12: Settings services (Telegram/Freelancer connect) and chat service

**Files:**
- Create: `packages/core/src/services/{errors.ts,telegramSetup.ts,freelancerSetup.ts,chatService.ts,index.ts}`, `packages/core/src/services/telegramSetup.test.ts`, `packages/core/src/services/freelancerSetup.test.ts`, `packages/core/src/services/chatService.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Store` (Task 9), `Secrets` (Task 10), `TelegramClient`, `TelegramError` (Task 8), `JobSource` (Task 11), `LlmClient` (Task 5), `runChatTurn` (Task 7), `resolvePrompts`, `buildChatSystemPrompt` (Task 3), schemas (Task 2)
- Produces (`@gighunter/core/services`):
  - `class ServiceError extends Error { status: number; code: string }`
  - `TELEGRAM_ALLOWED_UPDATES`, `webhookUrl(apiBaseUrl, userId)`
  - `connectTelegramBot(deps: TelegramSetupDeps, userId, token): Promise<Settings>`, `disconnectTelegramBot(deps, userId): Promise<Settings>`, `sendTelegramTest(deps, userId): Promise<void>` where `TelegramSetupDeps = { store: Store; secrets: Secrets; createTelegram: (token: string) => TelegramClient; apiBaseUrl: string; now: () => Date }`
  - `connectFreelancer(deps: FreelancerSetupDeps, userId, token): Promise<Settings>`, `disconnectFreelancer(deps, userId): Promise<Settings>` where `FreelancerSetupDeps = { store: Store; secrets: Secrets; sources: Record<Platform, JobSource>; now: () => Date }`
  - `sendChatMessage(deps: ChatServiceDeps, userId, ref: MatchRef, message: string): Promise<{ reply: string; truncated: boolean; usage: Usage; chat: Chat }>` where `ChatServiceDeps = { store: Store; createLlm: (model: string) => LlmClient; now: () => Date }`

- [ ] **Step 1: Failing tests**

`packages/core/src/services/telegramSetup.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { connectTelegramBot, disconnectTelegramBot, sendTelegramTest, webhookUrl } from './telegramSetup'
import { ServiceError } from './errors'
import { defaultSettings } from '../schema'
import type { Store } from '../store'
import type { Secrets } from '../secrets'
import type { TelegramClient } from '../notifier'

const now = () => new Date('2026-09-20T10:00:00.000Z')

function makeDeps(existing = defaultSettings(now().toISOString())) {
  const store = { getSettings: vi.fn().mockResolvedValue(existing), putSettings: vi.fn().mockResolvedValue(undefined) } as unknown as Store
  const secrets = { putUserSecret: vi.fn(), deleteUserSecret: vi.fn(), getUserSecret: vi.fn().mockResolvedValue('123:abc') } as unknown as Secrets
  const tg = { getMe: vi.fn().mockResolvedValue({ id: 1, username: 'gh_bot' }), setWebhook: vi.fn(), deleteWebhook: vi.fn(), sendMessage: vi.fn().mockResolvedValue({ messageId: 1 }) }
  const createTelegram = vi.fn().mockReturnValue(tg as unknown as TelegramClient)
  return { deps: { store, secrets, createTelegram, apiBaseUrl: 'https://api.example.com/', now }, store, secrets, tg, createTelegram }
}

describe('connectTelegramBot', () => {
  it('validates via getMe, registers webhook with a fresh secret, stores token and settings', async () => {
    const { deps, store, secrets, tg, createTelegram } = makeDeps({ ...defaultSettings(now().toISOString()), telegram: { tokenSet: false, chatId: '-100' } })
    const settings = await connectTelegramBot(deps, 'u1', '123:abcdEFGH')
    expect(createTelegram).toHaveBeenCalledWith('123:abcdEFGH')
    expect(tg.setWebhook).toHaveBeenCalledWith('https://api.example.com/telegram/webhook/u1', expect.stringMatching(/^[0-9a-f]{64}$/), ['message', 'callback_query', 'my_chat_member', 'channel_post'])
    expect(secrets.putUserSecret).toHaveBeenCalledWith('u1', 'telegram/bot-token', '123:abcdEFGH')
    expect(settings.telegram).toMatchObject({ tokenSet: true, tokenHint: 'EFGH', botUsername: 'gh_bot', chatId: '-100' })
    expect(settings.telegram.webhookSecret).toHaveLength(64)
    expect(store.putSettings).toHaveBeenCalledWith('u1', settings)
  })
  it('creates settings when none exist', async () => {
    const { deps, store } = makeDeps()
    ;(store.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const s = await connectTelegramBot(deps, 'u1', '1:a')
    expect(s.notifyThreshold).toBe(70)
  })
})

describe('disconnectTelegramBot', () => {
  it('deletes webhook and secret, clears telegram fields', async () => {
    const { deps, secrets, tg } = makeDeps({ ...defaultSettings(now().toISOString()), telegram: { tokenSet: true, chatId: '-1', botUsername: 'b', webhookSecret: 's' } })
    const s = await disconnectTelegramBot(deps, 'u1')
    expect(tg.deleteWebhook).toHaveBeenCalled()
    expect(secrets.deleteUserSecret).toHaveBeenCalledWith('u1', 'telegram/bot-token')
    expect(s.telegram).toEqual({ tokenSet: false })
  })
})

describe('sendTelegramTest', () => {
  it('throws 400 when not configured, sends otherwise', async () => {
    const unconfigured = makeDeps()
    await expect(sendTelegramTest(unconfigured.deps, 'u1')).rejects.toMatchObject({ status: 400, code: 'telegram_not_configured' })
    const ok = makeDeps({ ...defaultSettings(now().toISOString()), telegram: { tokenSet: true, chatId: '-100' } })
    await sendTelegramTest(ok.deps, 'u1')
    expect(ok.tg.sendMessage).toHaveBeenCalledWith('-100', expect.stringContaining('test'))
  })
  it('webhookUrl trims trailing slash', () => {
    expect(webhookUrl('https://a/', 'u')).toBe('https://a/telegram/webhook/u')
    expect(new ServiceError('x', 400, 'c').status).toBe(400)
  })
})
```

`packages/core/src/services/freelancerSetup.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { connectFreelancer, disconnectFreelancer } from './freelancerSetup'
import { defaultSettings } from '../schema'
import type { Store } from '../store'
import type { Secrets } from '../secrets'

const now = () => new Date('2026-09-20T10:00:00.000Z')
function makeDeps(verify: unknown) {
  const store = { getSettings: vi.fn().mockResolvedValue(defaultSettings(now().toISOString())), putSettings: vi.fn() } as unknown as Store
  const secrets = { putUserSecret: vi.fn(), deleteUserSecret: vi.fn() } as unknown as Secrets
  const sources = { freelancer: { platform: 'freelancer', fetchRecent: vi.fn(), verifyToken: vi.fn().mockResolvedValue(verify) }, upwork: { platform: 'upwork', fetchRecent: vi.fn(), verifyToken: vi.fn() } }
  return { deps: { store, secrets, sources: sources as never, now }, store, secrets }
}

describe('connectFreelancer', () => {
  it('stores token and marks connected on success', async () => {
    const { deps, secrets } = makeDeps({ ok: true, username: 'yev' })
    const s = await connectFreelancer(deps, 'u1', 'tok12345')
    expect(secrets.putUserSecret).toHaveBeenCalledWith('u1', 'freelancer/token', 'tok12345')
    expect(s.platforms.freelancer).toMatchObject({ tokenSet: true, tokenHint: '2345', connectedAs: 'yev' })
  })
  it('rejects invalid tokens with 400 and stores nothing', async () => {
    const { deps, secrets } = makeDeps({ ok: false, error: 'http_401' })
    await expect(connectFreelancer(deps, 'u1', 'bad')).rejects.toMatchObject({ status: 400, code: 'invalid_token' })
    expect(secrets.putUserSecret).not.toHaveBeenCalled()
  })
  it('disconnect clears token, connection and disables polling', async () => {
    const { deps, secrets } = makeDeps({ ok: true, username: 'yev' })
    const s = await disconnectFreelancer(deps, 'u1')
    expect(secrets.deleteUserSecret).toHaveBeenCalledWith('u1', 'freelancer/token')
    expect(s.platforms.freelancer).toEqual({ enabled: false, query: '', tokenSet: false })
  })
})
```

`packages/core/src/services/chatService.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { sendChatMessage } from './chatService'
import { defaultSettings, CHAT_MAX_MESSAGES } from '../schema'
import { SAMPLE_MATCH } from '../prompts'
import type { Store } from '../store'
import type { LlmClient } from '../llm'

const nowIso = '2026-09-20T10:00:00.000Z'
const now = () => new Date(nowIso)
const profile = { displayName: 'Yev', skills: [], budget: { min: 1, max: 9, currency: 'USD' as const }, maxHours: 4, languages: ['en'], stopWords: [], freeText: '', updatedAt: nowIso }
const ref = { platform: 'freelancer' as const, externalId: 'sample-1' }

function makeDeps(opts: { match?: unknown; chat?: unknown; reply?: string } = {}) {
  const store = {
    getMatch: vi.fn().mockResolvedValue(opts.match === undefined ? SAMPLE_MATCH : opts.match),
    getProfile: vi.fn().mockResolvedValue(profile),
    getSettings: vi.fn().mockResolvedValue({ ...defaultSettings(nowIso), chatModel: 'anthropic.claude-sonnet-5' }),
    getPrompts: vi.fn().mockResolvedValue(null),
    getChat: vi.fn().mockResolvedValue(opts.chat ?? null),
    putChat: vi.fn(),
  } as unknown as Store
  const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: opts.reply ?? 'Here is a draft.' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  const createLlm = vi.fn().mockReturnValue({ messages: { create, parse: vi.fn() } } as unknown as LlmClient)
  return { deps: { store, createLlm, now }, store, create, createLlm }
}

describe('sendChatMessage', () => {
  it('builds the system prompt from profile/job/score, runs a turn with the chat model and persists both messages', async () => {
    const { deps, store, create, createLlm } = makeDeps()
    const out = await sendChatMessage(deps, 'u1', ref, 'Draft a proposal')
    expect(createLlm).toHaveBeenCalledWith('anthropic.claude-sonnet-5')
    const params = create.mock.calls[0]![0]
    expect(params.system[0].text).toContain(SAMPLE_MATCH.job.title)
    expect(params.system[0].text).toContain('Score: 82/100')
    expect(params.messages).toEqual([{ role: 'user', content: 'Draft a proposal' }])
    expect(out.reply).toBe('Here is a draft.')
    expect(out.chat.messages).toEqual([
      { role: 'user', content: 'Draft a proposal', at: nowIso },
      { role: 'assistant', content: 'Here is a draft.', at: nowIso },
    ])
    expect(out.chat.usage).toEqual({ inputTokens: 100, outputTokens: 50 })
    expect(store.putChat).toHaveBeenCalledWith('u1', ref, out.chat)
  })
  it('404 when the match does not exist', async () => {
    const { deps } = makeDeps({ match: null })
    await expect(sendChatMessage(deps, 'u1', ref, 'x')).rejects.toMatchObject({ status: 404, code: 'match_not_found' })
  })
  it('409 when the chat is full and nothing is persisted', async () => {
    const full = { messages: Array.from({ length: CHAT_MAX_MESSAGES }, () => ({ role: 'user', content: 'm', at: nowIso })), usage: { inputTokens: 0, outputTokens: 0 }, createdAt: nowIso, updatedAt: nowIso, ttl: 1 }
    const { deps, store } = makeDeps({ chat: full })
    await expect(sendChatMessage(deps, 'u1', ref, 'x')).rejects.toMatchObject({ status: 409, code: 'chat_full' })
    expect(store.putChat).not.toHaveBeenCalled()
  })
  it('does not persist when the model call fails', async () => {
    const { deps, store, create } = makeDeps()
    create.mockRejectedValue(new Error('bedrock down'))
    await expect(sendChatMessage(deps, 'u1', ref, 'x')).rejects.toThrow('bedrock down')
    expect(store.putChat).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gighunter/core test -- services`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement**

`packages/core/src/services/errors.ts`:
```ts
export class ServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
    this.name = 'ServiceError'
  }
}
```

`packages/core/src/services/telegramSetup.ts`:
```ts
import { randomBytes } from 'node:crypto'
import type { TelegramClient } from '../notifier'
import { defaultSettings, type Settings } from '../schema'
import type { Secrets } from '../secrets'
import type { Store } from '../store'
import { ServiceError } from './errors'

export interface TelegramSetupDeps {
  store: Store
  secrets: Secrets
  createTelegram: (token: string) => TelegramClient
  apiBaseUrl: string
  now: () => Date
}

export const TELEGRAM_ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member', 'channel_post']

export const webhookUrl = (apiBaseUrl: string, userId: string) => `${apiBaseUrl.replace(/\/+$/, '')}/telegram/webhook/${userId}`

async function loadSettings(deps: Pick<TelegramSetupDeps, 'store' | 'now'>, userId: string): Promise<Settings> {
  return (await deps.store.getSettings(userId)) ?? defaultSettings(deps.now().toISOString())
}

export async function connectTelegramBot(deps: TelegramSetupDeps, userId: string, token: string): Promise<Settings> {
  const tg = deps.createTelegram(token)
  const me = await tg.getMe() // TelegramError propagates; the API maps it to 400
  const secret = randomBytes(32).toString('hex')
  await tg.setWebhook(webhookUrl(deps.apiBaseUrl, userId), secret, TELEGRAM_ALLOWED_UPDATES)
  await deps.secrets.putUserSecret(userId, 'telegram/bot-token', token)

  const settings = await loadSettings(deps, userId)
  settings.telegram = { ...settings.telegram, tokenSet: true, tokenHint: token.slice(-4), botUsername: me.username, webhookSecret: secret }
  settings.updatedAt = deps.now().toISOString()
  await deps.store.putSettings(userId, settings)
  return settings
}

export async function disconnectTelegramBot(deps: TelegramSetupDeps, userId: string): Promise<Settings> {
  const token = await deps.secrets.getUserSecret(userId, 'telegram/bot-token')
  if (token) {
    try { await deps.createTelegram(token).deleteWebhook() } catch { /* token may already be revoked; still clear our side */ }
  }
  await deps.secrets.deleteUserSecret(userId, 'telegram/bot-token')
  const settings = await loadSettings(deps, userId)
  settings.telegram = { tokenSet: false }
  settings.updatedAt = deps.now().toISOString()
  await deps.store.putSettings(userId, settings)
  return settings
}

export async function sendTelegramTest(deps: TelegramSetupDeps, userId: string): Promise<void> {
  const settings = await loadSettings(deps, userId)
  const token = settings.telegram.tokenSet ? await deps.secrets.getUserSecret(userId, 'telegram/bot-token') : null
  if (!token || !settings.telegram.chatId) throw new ServiceError('Connect a bot and a chat first', 400, 'telegram_not_configured')
  await deps.createTelegram(token).sendMessage(settings.telegram.chatId, '✅ GigHunter test message — notifications will arrive here.')
}
```

`packages/core/src/services/freelancerSetup.ts`:
```ts
import type { JobSource } from '../adapters'
import { defaultSettings, type Platform, type Settings } from '../schema'
import type { Secrets } from '../secrets'
import type { Store } from '../store'
import { ServiceError } from './errors'

export interface FreelancerSetupDeps {
  store: Store
  secrets: Secrets
  sources: Record<Platform, JobSource>
  now: () => Date
}

export async function connectFreelancer(deps: FreelancerSetupDeps, userId: string, token: string): Promise<Settings> {
  const verified = await deps.sources.freelancer.verifyToken(token)
  if (!verified.ok) throw new ServiceError(`Freelancer.com rejected the token (${verified.error})`, 400, 'invalid_token')
  await deps.secrets.putUserSecret(userId, 'freelancer/token', token)
  const settings = (await deps.store.getSettings(userId)) ?? defaultSettings(deps.now().toISOString())
  settings.platforms.freelancer = { ...settings.platforms.freelancer, tokenSet: true, tokenHint: token.slice(-4), connectedAs: verified.username }
  settings.updatedAt = deps.now().toISOString()
  await deps.store.putSettings(userId, settings)
  return settings
}

export async function disconnectFreelancer(deps: FreelancerSetupDeps, userId: string): Promise<Settings> {
  await deps.secrets.deleteUserSecret(userId, 'freelancer/token')
  const settings = (await deps.store.getSettings(userId)) ?? defaultSettings(deps.now().toISOString())
  settings.platforms.freelancer = { enabled: false, query: settings.platforms.freelancer.query, tokenSet: false }
  settings.updatedAt = deps.now().toISOString()
  await deps.store.putSettings(userId, settings)
  return settings
}
```

`packages/core/src/services/chatService.ts`:
```ts
import { runChatTurn } from '../chat'
import type { LlmClient } from '../llm'
import { buildChatSystemPrompt, resolvePrompts } from '../prompts'
import { CHAT_MAX_BYTES, CHAT_MAX_MESSAGES, defaultSettings, type Chat, type MatchRef, type Usage } from '../schema'
import { CHAT_TTL_DAYS, ttlAfterDays, type Store } from '../store'
import { ServiceError } from './errors'

export interface ChatServiceDeps {
  store: Store
  createLlm: (model: string) => LlmClient
  now: () => Date
}

export async function sendChatMessage(
  deps: ChatServiceDeps,
  userId: string,
  ref: MatchRef,
  message: string,
): Promise<{ reply: string; truncated: boolean; usage: Usage; chat: Chat }> {
  const nowIso = deps.now().toISOString()
  const [match, profile, settingsOrNull, promptsOverride, existing] = await Promise.all([
    deps.store.getMatch(userId, ref),
    deps.store.getProfile(userId),
    deps.store.getSettings(userId),
    deps.store.getPrompts(userId),
    deps.store.getChat(userId, ref),
  ])
  if (!match) throw new ServiceError('Job not found', 404, 'match_not_found')
  if (!profile) throw new ServiceError('Fill in your profile first', 400, 'profile_missing')
  const settings = settingsOrNull ?? defaultSettings(nowIso)
  const chat: Chat = existing ?? { messages: [], usage: { inputTokens: 0, outputTokens: 0 }, createdAt: nowIso, updatedAt: nowIso, ttl: ttlAfterDays(nowIso, CHAT_TTL_DAYS) }

  if (chat.messages.length + 2 > CHAT_MAX_MESSAGES || Buffer.byteLength(JSON.stringify(chat)) > CHAT_MAX_BYTES) {
    throw new ServiceError('This chat is full — reset it to continue', 409, 'chat_full')
  }

  const prompts = resolvePrompts(promptsOverride)
  const systemPrompt = buildChatSystemPrompt(prompts.chat, profile, match)
  const turn = await runChatTurn({
    client: deps.createLlm(settings.chatModel),
    model: settings.chatModel,
    systemPrompt,
    history: chat.messages,
    userMessage: message,
  })

  chat.messages.push({ role: 'user', content: message, at: nowIso }, { role: 'assistant', content: turn.reply, at: deps.now().toISOString() })
  chat.usage = { inputTokens: chat.usage.inputTokens + turn.usage.inputTokens, outputTokens: chat.usage.outputTokens + turn.usage.outputTokens }
  chat.updatedAt = deps.now().toISOString()
  await deps.store.putChat(userId, ref, chat)
  return { reply: turn.reply, truncated: turn.truncated, usage: turn.usage, chat }
}
```

`packages/core/src/services/index.ts`:
```ts
export * from './errors'
export * from './telegramSetup'
export * from './freelancerSetup'
export * from './chatService'
```
Append to `packages/core/src/index.ts`: `export * from './services/index'`

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @gighunter/core test -- services && pnpm --filter @gighunter/core typecheck`
Expected: pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): Telegram/Freelancer connect services and per-job chat service"
```

---

### Task 13: Pipeline `runForUser`

**Files:**
- Create: `packages/core/src/pipeline/{runForUser.ts,index.ts}`, `packages/core/src/pipeline/runForUser.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: everything above.
- Produces (`@gighunter/core/pipeline`):
  - `interface PipelineDeps { store: Store; secrets: Secrets; sources: Record<Platform, JobSource>; createLlm: (model: string) => LlmClient; createTelegram: (token: string) => TelegramClient; appUrl: string; now: () => Date; log: Logger }`
  - `runForUser(deps: PipelineDeps, userId: string, trigger: 'schedule' | 'manual'): Promise<Run>`

- [ ] **Step 1: Failing tests**

`packages/core/src/pipeline/runForUser.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { runForUser, type PipelineDeps } from './runForUser'
import { defaultSettings, type Job, type Match } from '../schema'
import { SourceError } from '../adapters'
import { createLogger } from '../logger'

const nowIso = '2026-09-20T12:00:00.000Z'
const profile = { displayName: 'Yev', skills: [{ name: 'React', level: 'expert' as const }], budget: { min: 50, max: 500, currency: 'USD' as const }, maxHours: 6, languages: ['en'], stopWords: ['wordpress'], freeText: '', updatedAt: nowIso }
const settings = () => {
  const s = defaultSettings(nowIso)
  s.active = true
  s.telegram = { tokenSet: true, chatId: '-100', webhookSecret: 's' }
  s.platforms.freelancer = { enabled: true, query: 'react', tokenSet: true }
  return s
}
const job = (id: string, patch: Partial<Job> = {}): Job => ({
  platform: 'freelancer', externalId: id, url: `https://f.test/${id}`, title: `Job ${id}`, description: 'Small React fix',
  budget: { min: 100, max: 200, currency: 'USD', type: 'fixed' }, skills: ['React'], postedAt: '2026-09-20T11:00:00.000Z', language: 'en', ...patch,
})

function makeDeps(opts: { settings?: ReturnType<typeof settings> | null; jobs?: Job[]; known?: string[]; pending?: Match[]; score?: number; scoreFails?: boolean; sendFails?: boolean; fetchError?: Error } = {}) {
  const calls: string[] = []
  const store = {
    getProfile: vi.fn().mockResolvedValue(profile),
    getSettings: vi.fn().mockResolvedValue(opts.settings === undefined ? settings() : opts.settings),
    getPrompts: vi.fn().mockResolvedValue(null),
    listMatches: vi.fn().mockImplementation(async () => ({ items: opts.pending ?? [] })),
    existingMatchKeys: vi.fn().mockResolvedValue(new Set(opts.known ?? [])),
    putMatch: vi.fn().mockImplementation(async (_u: string, m: Match) => { calls.push(`put:${m.job.externalId}:${m.status}`) }),
    updateMatchStatus: vi.fn().mockImplementation(async (_u: string, ref: { externalId: string }, p: { status: string }) => { calls.push(`update:${ref.externalId}:${p.status}`) }),
    putRun: vi.fn().mockResolvedValue(undefined),
  }
  const secrets = { getUserSecret: vi.fn().mockImplementation(async (_u: string, name: string) => (name === 'telegram/bot-token' ? 'bot' : 'fl-token')) }
  const fetchRecent = vi.fn().mockImplementation(async () => { calls.push('fetch'); if (opts.fetchError) throw opts.fetchError; return opts.jobs ?? [] })
  const sources = { freelancer: { platform: 'freelancer', fetchRecent, verifyToken: vi.fn() }, upwork: { platform: 'upwork', fetchRecent: vi.fn().mockResolvedValue([]), verifyToken: vi.fn() } }
  const parse = vi.fn().mockImplementation(async () => {
    if (opts.scoreFails) throw new Error('bedrock throttled')
    return { parsed_output: { score: opts.score ?? 85, reasoning: 'fits', estimatedHours: 2, risks: [] }, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, stop_reason: 'end_turn' }
  })
  const sendMessage = vi.fn().mockImplementation(async () => { calls.push('send'); if (opts.sendFails) throw new Error('tg down'); return { messageId: 99 } })
  const deps = {
    store, secrets, sources, createLlm: () => ({ messages: { create: vi.fn(), parse } }), createTelegram: () => ({ sendMessage }),
    appUrl: 'https://app', now: () => new Date(nowIso), log: createLogger({}, () => {}),
  } as unknown as PipelineDeps
  return { deps, store, calls, sendMessage, parse, fetchRecent }
}

describe('runForUser', () => {
  it('records telegram_not_configured and fetches nothing when chat/token missing', async () => {
    const s = settings(); s.telegram = { tokenSet: false }
    const { deps, store, fetchRecent } = makeDeps({ settings: s })
    const run = await runForUser(deps, 'u1', 'schedule')
    expect(run.errors).toEqual(['telegram_not_configured'])
    expect(fetchRecent).not.toHaveBeenCalled()
    expect(store.putRun).toHaveBeenCalledWith('u1', expect.objectContaining({ finishedAt: nowIso, trigger: 'schedule' }))
  })

  it('dedups, filters, scores, notifies and accounts usage', async () => {
    const jobs = [job('known'), job('wp', { title: 'WordPress theme' }), job('good')]
    const { deps, calls, sendMessage, parse } = makeDeps({ jobs, known: ['freelancer#known'] })
    const run = await runForUser(deps, 'u1', 'manual')
    expect(parse).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['fetch', 'put:wp:filtered', 'put:good:pending', 'send', 'update:good:notified'])
    expect(sendMessage.mock.calls[0]![1]).toContain('Job good')
    expect(run.perPlatform.freelancer).toEqual({ fetched: 3, new: 2, filtered: 1, scored: 1, notified: 1 })
    expect(run.usage).toEqual({ inputTokens: 100, outputTokens: 20 })
    expect(run.errors).toEqual([])
  })

  it('stores below-threshold jobs as scored without notifying', async () => {
    const { deps, calls, sendMessage } = makeDeps({ jobs: [job('meh')], score: 40 })
    await runForUser(deps, 'u1', 'schedule')
    expect(calls).toEqual(['fetch', 'put:meh:scored'])
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('retries pending matches before fetching', async () => {
    const pending: Match = { job: job('old'), status: 'pending', score: { score: 90, reasoning: 'r', estimatedHours: 1, risks: [] }, verdict: 'strong', createdAt: nowIso, ttl: 1 }
    const { deps, calls } = makeDeps({ pending: [pending], jobs: [] })
    const run = await runForUser(deps, 'u1', 'schedule')
    expect(calls).toEqual(['send', 'update:old:notified', 'fetch'])
    expect(run.perPlatform.freelancer.notified).toBe(1)
  })

  it('keeps the match pending when Telegram fails', async () => {
    const { deps, calls } = makeDeps({ jobs: [job('x')], sendFails: true })
    const run = await runForUser(deps, 'u1', 'schedule')
    expect(calls).toEqual(['fetch', 'put:x:pending', 'send'])
    expect(run.errors[0]).toMatch(/^notify:/)
    expect(run.perPlatform.freelancer.notified).toBe(0)
  })

  it('skips a job whose scoring fails and continues', async () => {
    const { deps, calls } = makeDeps({ jobs: [job('a')], scoreFails: true })
    const run = await runForUser(deps, 'u1', 'schedule')
    expect(calls).toEqual(['fetch'])
    expect(run.errors[0]).toMatch(/^score:freelancer:a:/)
    expect(run.perPlatform.freelancer.scored).toBe(0)
  })

  it('records adapter errors per platform and still finishes the run', async () => {
    const { deps, store } = makeDeps({ fetchError: new SourceError('rl', 'rate_limited', 30) })
    const run = await runForUser(deps, 'u1', 'schedule')
    expect(run.perPlatform.freelancer.error).toBe('rate_limited')
    expect(store.putRun).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gighunter/core test -- pipeline`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`packages/core/src/pipeline/runForUser.ts`:
```ts
import { enabledPlatforms, SourceError, type JobSource } from '../adapters'
import { preFilter } from '../filter'
import type { LlmClient } from '../llm'
import type { Logger } from '../logger'
import { formatMatchMessage, type TelegramClient } from '../notifier'
import { buildScoringSystemPrompt, resolvePrompts } from '../prompts'
import { emptyPlatformStats, type Match, type Platform, type Run, type Settings } from '../schema'
import type { Secrets, UserSecretName } from '../secrets'
import { MATCH_TTL_DAYS, RUN_TTL_DAYS, matchKey, ttlAfterDays, type Store } from '../store'
import { scoreJob } from '../scorer'

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
      deps.store.getProfile(userId), deps.store.getSettings(userId), deps.store.getPrompts(userId),
    ])
    if (!profile || !settings) { run.errors.push('profile_or_settings_missing'); return await finish() }

    const botToken = settings.telegram.tokenSet ? await deps.secrets.getUserSecret(userId, 'telegram/bot-token') : null
    const chatId = settings.telegram.chatId
    if (!botToken || !chatId) { run.errors.push('telegram_not_configured'); log.warn('run.skipped', { reason: 'telegram_not_configured' }); return await finish() }
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
        if (!token) { s.error = 'token_missing'; continue }

        const jobs = await deps.sources[platform].fetchRecent({ query: platformQuery(settings, platform), since, token })
        s.fetched = jobs.length
        const known = await deps.store.existingMatchKeys(userId, jobs)
        const fresh = jobs.filter((j) => !known.has(matchKey(j)))
        s.new = fresh.length

        for (const job of fresh) {
          const nowIso = deps.now().toISOString()
          const ttl = ttlAfterDays(nowIso, MATCH_TTL_DAYS)
          const reason = preFilter(job, profile, settings, deps.now())
          if (reason) {
            await deps.store.putMatch(userId, { job, status: 'filtered', filterReason: reason, createdAt: nowIso, ttl })
            s.filtered++
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
```

`packages/core/src/pipeline/index.ts`: `export * from './runForUser'`
Append to `packages/core/src/index.ts`: `export * from './pipeline/index'`

- [ ] **Step 4: Run all core tests + typecheck**

Run: `pnpm --filter @gighunter/core test && pnpm --filter @gighunter/core typecheck`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): runForUser pipeline (retry pending, dedup, filter, score, notify)"
```

---

### Task 14: Lambda build script and shared deps

**Files:**
- Create: `apps/lambdas/build.mjs`, `apps/lambdas/src/shared/deps.ts`, `apps/lambdas/src/shared/deps.test.ts`

**Interfaces:**
- Produces: `env(name: string): string` (throws when unset), `buildCoreDeps(fn: string): CoreDeps` where `CoreDeps = Omit<PipelineDeps, 'appUrl'>`; env vars read: `AWS_REGION`, `TABLE_NAME`, `SSM_PREFIX` (optional, default `/gighunter`).

- [ ] **Step 1: Failing test**

`apps/lambdas/src/shared/deps.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { env, buildCoreDeps } from './deps'

describe('deps', () => {
  it('env throws on missing variables', () => {
    delete process.env.NOPE_X
    expect(() => env('NOPE_X')).toThrow(/NOPE_X/)
  })
  it('buildCoreDeps wires store/secrets/sources/factories from env', () => {
    process.env.TABLE_NAME = 'tbl'
    process.env.AWS_REGION = 'us-east-1'
    const deps = buildCoreDeps('test')
    expect(deps.store).toBeDefined()
    expect(deps.secrets.userParamName('u', 'freelancer/token')).toBe('/gighunter/users/u/freelancer/token')
    expect(deps.sources.freelancer.platform).toBe('freelancer')
    expect(typeof deps.createLlm).toBe('function')
    expect(typeof deps.createTelegram).toBe('function')
    expect(deps.now()).toBeInstanceOf(Date)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gighunter/lambdas test`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`apps/lambdas/build.mjs`:
```js
import { build } from 'esbuild'

const functions = ['poller', 'api', 'tg-webhook', 'pre-signup']

await Promise.all(
  functions.map((fn) =>
    build({
      entryPoints: [`src/${fn}/index.ts`],
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      outfile: `dist/${fn}/index.mjs`,
      sourcemap: false,
      minify: false,
      logLevel: 'info',
      // Some CJS deps call require() at runtime; give them one in the ESM bundle.
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    }),
  ),
)
```

`apps/lambdas/src/shared/deps.ts`:
```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { SSMClient } from '@aws-sdk/client-ssm'
import { createSources } from '@gighunter/core/adapters'
import { createBedrockClient } from '@gighunter/core/llm'
import { createLogger } from '@gighunter/core/logger'
import { TelegramClient } from '@gighunter/core/notifier'
import type { PipelineDeps } from '@gighunter/core/pipeline'
import { Secrets } from '@gighunter/core/secrets'
import { Store } from '@gighunter/core/store'

export type CoreDeps = Omit<PipelineDeps, 'appUrl'>

export function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required environment variable ${name}`)
  return v
}

export function buildCoreDeps(fn: string): CoreDeps {
  const region = process.env.AWS_REGION ?? 'us-east-1'
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } })
  return {
    store: new Store(doc, env('TABLE_NAME')),
    secrets: new Secrets(new SSMClient({ region }), process.env.SSM_PREFIX ?? '/gighunter'),
    sources: createSources(),
    createLlm: (model) => createBedrockClient(model, region),
    createTelegram: (token) => new TelegramClient(token),
    now: () => new Date(),
    log: createLogger({ fn }),
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @gighunter/lambdas test && pnpm --filter @gighunter/lambdas typecheck`
Expected: pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(lambdas): esbuild bundling and shared dependency wiring"
```

---

### Task 15: Poller Lambda

**Files:**
- Create: `apps/lambdas/src/poller/{handler.ts,index.ts}`, `apps/lambdas/src/poller/handler.test.ts`

**Interfaces:**
- Consumes: `PipelineDeps`, `runForUser` (Task 13), `buildCoreDeps`, `env` (Task 14)
- Produces: `type PollerEvent = { trigger?: 'schedule' | 'manual'; userId?: string }`, `createPollerHandler(deps: PipelineDeps, run = runForUser)` returning `(event: PollerEvent) => Promise<{ processed: number; results: { userId: string; errors: number }[] }>`; `handler` export in `index.ts`. Env: `APP_URL`.

- [ ] **Step 1: Failing test**

`apps/lambdas/src/poller/handler.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createPollerHandler } from './handler'
import { createLogger } from '@gighunter/core/logger'
import type { PipelineDeps } from '@gighunter/core/pipeline'

function makeDeps(users: string[]) {
  return { store: { listActiveUsers: vi.fn().mockResolvedValue(users) }, log: createLogger({}, () => {}) } as unknown as PipelineDeps
}

describe('poller handler', () => {
  it('runs every active user on schedule and isolates failures', async () => {
    const deps = makeDeps(['a', 'b', 'c'])
    const run = vi.fn()
      .mockResolvedValueOnce({ errors: [] })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ errors: ['x'] })
    const out = await createPollerHandler(deps, run as never)({ trigger: 'schedule' })
    expect(run.mock.calls.map((c) => [c[1], c[2]])).toEqual([['a', 'schedule'], ['b', 'schedule'], ['c', 'schedule']])
    expect(out).toEqual({ processed: 3, results: [{ userId: 'a', errors: 0 }, { userId: 'b', errors: -1 }, { userId: 'c', errors: 1 }] })
  })
  it('runs only the given user on manual trigger', async () => {
    const deps = makeDeps(['a', 'b'])
    const run = vi.fn().mockResolvedValue({ errors: [] })
    const out = await createPollerHandler(deps, run as never)({ trigger: 'manual', userId: 'z' })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]![1]).toBe('z')
    expect(out.processed).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gighunter/lambdas test -- poller`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`apps/lambdas/src/poller/handler.ts`:
```ts
import { runForUser, type PipelineDeps } from '@gighunter/core/pipeline'

export interface PollerEvent { trigger?: 'schedule' | 'manual'; userId?: string }
export interface PollerResult { processed: number; results: { userId: string; errors: number }[] }

export function createPollerHandler(deps: PipelineDeps, run: typeof runForUser = runForUser) {
  return async (event: PollerEvent): Promise<PollerResult> => {
    const trigger = event.trigger ?? 'schedule'
    const users = event.userId ? [event.userId] : await deps.store.listActiveUsers()
    deps.log.info('poller.start', { trigger, users: users.length })
    const results: PollerResult['results'] = []
    for (const userId of users) {
      try {
        const r = await run(deps, userId, trigger)
        results.push({ userId, errors: r.errors.length })
      } catch (e) {
        deps.log.error('poller.user_failed', { userId, err: e })
        results.push({ userId, errors: -1 })
      }
    }
    return { processed: results.length, results }
  }
}
```

`apps/lambdas/src/poller/index.ts`:
```ts
import { buildCoreDeps, env } from '../shared/deps'
import { createPollerHandler } from './handler'

export const handler = createPollerHandler({ ...buildCoreDeps('poller'), appUrl: env('APP_URL') })
```

- [ ] **Step 4: Run test + typecheck + build**

Run: `pnpm --filter @gighunter/lambdas test -- poller && pnpm --filter @gighunter/lambdas typecheck && pnpm --filter @gighunter/lambdas build`
Expected: tests pass; build fails only for the three functions that do not exist yet — temporarily run `node -e "import('esbuild').then(({build})=>build({entryPoints:['src/poller/index.ts'],bundle:true,platform:'node',target:'node22',format:'esm',outfile:'dist/poller/index.mjs',banner:{js:\"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);\"}}))"` from `apps/lambdas` to confirm the poller bundles, and check `ls -la dist/poller/`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(lambdas): poller handler"
```

---

### Task 16: Pre-sign-up Lambda (email allowlist)

**Files:**
- Create: `apps/lambdas/src/pre-signup/{handler.ts,index.ts}`, `apps/lambdas/src/pre-signup/handler.test.ts`

**Interfaces:**
- Consumes: `Secrets.getAllowedEmails` (Task 10), `Logger`
- Produces: `createPreSignupHandler(deps: { secrets: Pick<Secrets, 'getAllowedEmails'>; log: Logger })` returning a Cognito `PreSignUpTriggerHandler`.

- [ ] **Step 1: Failing test**

`apps/lambdas/src/pre-signup/handler.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import type { PreSignUpTriggerEvent } from 'aws-lambda'
import { createPreSignupHandler } from './handler'
import { createLogger } from '@gighunter/core/logger'

const event = (email?: string) =>
  ({ request: { userAttributes: email ? { email } : {} }, response: { autoConfirmUser: false, autoVerifyEmail: false, autoVerifyPhone: false } }) as unknown as PreSignUpTriggerEvent

describe('pre-signup', () => {
  const deps = { secrets: { getAllowedEmails: vi.fn().mockResolvedValue(['me@example.com']) }, log: createLogger({}, () => {}) }
  it('auto-confirms allowlisted emails (case-insensitive)', async () => {
    const out = await createPreSignupHandler(deps)(event('Me@Example.com'), {} as never, () => {})
    expect(out!.response.autoConfirmUser).toBe(true)
    expect(out!.response.autoVerifyEmail).toBe(true)
  })
  it('rejects unknown and missing emails', async () => {
    await expect(createPreSignupHandler(deps)(event('x@y.com'), {} as never, () => {})).rejects.toThrow(/invitation/)
    await expect(createPreSignupHandler(deps)(event(), {} as never, () => {})).rejects.toThrow(/invitation/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gighunter/lambdas test -- pre-signup`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`apps/lambdas/src/pre-signup/handler.ts`:
```ts
import type { PreSignUpTriggerHandler } from 'aws-lambda'
import type { Logger } from '@gighunter/core/logger'
import type { Secrets } from '@gighunter/core/secrets'

export function createPreSignupHandler(deps: { secrets: Pick<Secrets, 'getAllowedEmails'>; log: Logger }): PreSignUpTriggerHandler {
  return async (event) => {
    const email = (event.request.userAttributes.email ?? '').trim().toLowerCase()
    const allowed = await deps.secrets.getAllowedEmails()
    if (!email || !allowed.includes(email)) {
      deps.log.warn('signup.rejected', { email })
      throw new Error('Sign-up is by invitation only.')
    }
    event.response.autoConfirmUser = true
    event.response.autoVerifyEmail = true
    deps.log.info('signup.allowed', { email })
    return event
  }
}
```

`apps/lambdas/src/pre-signup/index.ts`:
```ts
import { SSMClient } from '@aws-sdk/client-ssm'
import { createLogger } from '@gighunter/core/logger'
import { Secrets } from '@gighunter/core/secrets'
import { createPreSignupHandler } from './handler'

const region = process.env.AWS_REGION ?? 'us-east-1'
export const handler = createPreSignupHandler({
  secrets: new Secrets(new SSMClient({ region }), process.env.SSM_PREFIX ?? '/gighunter'),
  log: createLogger({ fn: 'pre-signup' }),
})
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @gighunter/lambdas test -- pre-signup && pnpm --filter @gighunter/lambdas typecheck`
Expected: pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(lambdas): Cognito pre-sign-up allowlist trigger"
```

---

### Task 17: Telegram webhook Lambda

**Files:**
- Create: `apps/lambdas/src/tg-webhook/{handler.ts,index.ts}`, `apps/lambdas/src/tg-webhook/handler.test.ts`

**Interfaces:**
- Consumes: `Store` (`getSettings`, `putSettings`, `setMatchFeedback`), `Secrets.getUserSecret`, `TelegramClient`, `parseFeedbackCallbackData`, `feedbackChosenKeyboard`
- Produces: `createWebhookHandler(deps: WebhookDeps)` with `WebhookDeps = { store: Store; secrets: Secrets; createTelegram: (token: string) => TelegramClient; now: () => Date; log: Logger }`, returning `(event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>`.

- [ ] **Step 1: Failing tests**

`apps/lambdas/src/tg-webhook/handler.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { createWebhookHandler } from './handler'
import { defaultSettings } from '@gighunter/core/schema'
import { SAMPLE_MATCH } from '@gighunter/core/prompts'
import { createLogger } from '@gighunter/core/logger'

const nowIso = '2026-09-20T10:00:00.000Z'
const base = () => ({ ...defaultSettings(nowIso), telegram: { tokenSet: true, webhookSecret: 'sec', chatId: '-100', chatTitle: 'My gigs' } })

function makeDeps(settings = base()) {
  const store = {
    getSettings: vi.fn().mockResolvedValue(settings),
    putSettings: vi.fn(),
    setMatchFeedback: vi.fn().mockResolvedValue({ ...SAMPLE_MATCH, feedback: 'up' }),
  }
  const tg = { answerCallbackQuery: vi.fn(), editMessageReplyMarkup: vi.fn(), sendMessage: vi.fn() }
  const deps = { store, secrets: { getUserSecret: vi.fn().mockResolvedValue('bot-token') }, createTelegram: vi.fn().mockReturnValue(tg), now: () => new Date(nowIso), log: createLogger({}, () => {}) }
  return { deps: deps as never, store, tg }
}
const event = (body: unknown, secret = 'sec', userId = 'u1') =>
  ({ pathParameters: { userId }, headers: { 'x-telegram-bot-api-secret-token': secret }, body: typeof body === 'string' ? body : JSON.stringify(body) }) as unknown as APIGatewayProxyEventV2

describe('tg-webhook', () => {
  it('403 on secret mismatch or missing settings', async () => {
    const { deps } = makeDeps()
    expect((await createWebhookHandler(deps)(event({}, 'wrong'))).statusCode).toBe(403)
    const { deps: none } = makeDeps(null as never)
    expect((await createWebhookHandler(none)(event({}))).statusCode).toBe(403)
  })
  it('400 on bad JSON, 200 on unknown update', async () => {
    const { deps } = makeDeps()
    expect((await createWebhookHandler(deps)(event('{nope'))).statusCode).toBe(400)
    expect((await createWebhookHandler(deps)(event({ update_id: 1 }))).statusCode).toBe(200)
  })
  it('callback_query stores feedback, answers and swaps the keyboard', async () => {
    const { deps, store, tg } = makeDeps()
    const res = await createWebhookHandler(deps)(event({ callback_query: { id: 'cq1', data: 'fb:freelancer:sample-1:up', message: { message_id: 7, chat: { id: -100 } } } }))
    expect(res.statusCode).toBe(200)
    expect(store.setMatchFeedback).toHaveBeenCalledWith('u1', { platform: 'freelancer', externalId: 'sample-1' }, 'up', nowIso)
    expect(tg.answerCallbackQuery).toHaveBeenCalledWith('cq1', expect.any(String))
    expect(tg.editMessageReplyMarkup).toHaveBeenCalledWith('-100', 7, { inline_keyboard: [[{ text: '✅ Marked useful', callback_data: 'noop' }]] })
  })
  it('callback with unknown data is answered and ignored', async () => {
    const { deps, store, tg } = makeDeps()
    await createWebhookHandler(deps)(event({ callback_query: { id: 'cq2', data: 'noop' } }))
    expect(store.setMatchFeedback).not.toHaveBeenCalled()
    expect(tg.answerCallbackQuery).toHaveBeenCalledWith('cq2')
  })
  it('/start in a private chat sets chatId and replies', async () => {
    const { deps, store, tg } = makeDeps()
    await createWebhookHandler(deps)(event({ message: { text: '/start', chat: { id: 555, type: 'private' }, from: { username: 'yev' } } }))
    expect(store.putSettings).toHaveBeenCalledWith('u1', expect.objectContaining({ telegram: expect.objectContaining({ chatId: '555', chatTitle: 'DM with @yev' }) }))
    expect(tg.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('Connected'))
  })
  it('bot promoted to admin in a channel sets chatId; removal clears it', async () => {
    const { deps, store } = makeDeps()
    await createWebhookHandler(deps)(event({ my_chat_member: { chat: { id: -200, type: 'channel', title: 'Gigs' }, new_chat_member: { status: 'administrator' } } }))
    expect(store.putSettings.mock.calls[0]![1].telegram).toMatchObject({ chatId: '-200', chatTitle: 'Gigs' })
    const { deps: d2, store: s2 } = makeDeps()
    await createWebhookHandler(d2)(event({ my_chat_member: { chat: { id: -100, type: 'channel', title: 'My gigs' }, new_chat_member: { status: 'left' } } }))
    expect(s2.putSettings.mock.calls[0]![1].telegram.chatId).toBeUndefined()
  })
  it('channel_post only sets chatId when none is configured', async () => {
    const { deps, store } = makeDeps({ ...base(), telegram: { tokenSet: true, webhookSecret: 'sec' } })
    await createWebhookHandler(deps)(event({ channel_post: { chat: { id: -300, type: 'channel', title: 'New' } } }))
    expect(store.putSettings.mock.calls[0]![1].telegram).toMatchObject({ chatId: '-300', chatTitle: 'New' })
    const { deps: d2, store: s2 } = makeDeps()
    await createWebhookHandler(d2)(event({ channel_post: { chat: { id: -300, type: 'channel', title: 'New' } } }))
    expect(s2.putSettings).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gighunter/lambdas test -- tg-webhook`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`apps/lambdas/src/tg-webhook/handler.ts`:
```ts
import { timingSafeEqual } from 'node:crypto'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import type { Logger } from '@gighunter/core/logger'
import { feedbackChosenKeyboard, parseFeedbackCallbackData, type TelegramClient } from '@gighunter/core/notifier'
import type { Settings } from '@gighunter/core/schema'
import type { Secrets } from '@gighunter/core/secrets'
import type { Store } from '@gighunter/core/store'

export interface WebhookDeps {
  store: Store
  secrets: Secrets
  createTelegram: (token: string) => TelegramClient
  now: () => Date
  log: Logger
}

// Minimal Telegram Bot API update shapes used here.
interface TgChat { id: number; type: string; title?: string; first_name?: string }
interface TgUpdate {
  message?: { text?: string; chat: TgChat; from?: { username?: string; first_name?: string } }
  channel_post?: { chat: TgChat }
  my_chat_member?: { chat: TgChat; new_chat_member: { status: string } }
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: TgChat } }
}

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const text = (statusCode: number, body: string): APIGatewayProxyResultV2 => ({ statusCode, body })

export function createWebhookHandler(deps: WebhookDeps) {
  const saveChat = async (userId: string, settings: Settings, chatId: string | undefined, chatTitle: string | undefined) => {
    const { chatId: _c, chatTitle: _t, ...rest } = settings.telegram
    settings.telegram = { ...rest, ...(chatId ? { chatId, chatTitle } : {}) }
    settings.updatedAt = deps.now().toISOString()
    await deps.store.putSettings(userId, settings)
    deps.log.info('webhook.chat_updated', { userId, chatId })
  }

  const handleUpdate = async (userId: string, settings: Settings, update: TgUpdate) => {
    if (update.callback_query) {
      const cq = update.callback_query
      const token = await deps.secrets.getUserSecret(userId, 'telegram/bot-token')
      if (!token) return
      const tg = deps.createTelegram(token)
      const parsed = parseFeedbackCallbackData(cq.data ?? '')
      if (!parsed) { await tg.answerCallbackQuery(cq.id); return }
      const match = await deps.store.setMatchFeedback(userId, { platform: parsed.platform, externalId: parsed.externalId }, parsed.feedback, deps.now().toISOString())
      await tg.answerCallbackQuery(cq.id, match ? 'Thanks, noted!' : 'Job not found')
      if (match && cq.message) await tg.editMessageReplyMarkup(String(cq.message.chat.id), cq.message.message_id, feedbackChosenKeyboard(parsed.feedback))
      return
    }

    if (update.message?.chat.type === 'private' && update.message.text?.startsWith('/start')) {
      const chatId = String(update.message.chat.id)
      const who = update.message.from?.username ? `@${update.message.from.username}` : (update.message.from?.first_name ?? 'you')
      await saveChat(userId, settings, chatId, `DM with ${who}`)
      const token = await deps.secrets.getUserSecret(userId, 'telegram/bot-token')
      if (token) await deps.createTelegram(token).sendMessage(chatId, '✅ Connected. GigHunter notifications will arrive here.')
      return
    }

    if (update.my_chat_member) {
      const { chat, new_chat_member } = update.my_chat_member
      const chatId = String(chat.id)
      const isGroupLike = chat.type === 'channel' || chat.type === 'supergroup' || chat.type === 'group'
      if (new_chat_member.status === 'administrator' && isGroupLike) await saveChat(userId, settings, chatId, chat.title ?? chatId)
      else if ((new_chat_member.status === 'left' || new_chat_member.status === 'kicked') && settings.telegram.chatId === chatId) await saveChat(userId, settings, undefined, undefined)
      return
    }

    if (update.channel_post && !settings.telegram.chatId) {
      const { chat } = update.channel_post
      await saveChat(userId, settings, String(chat.id), chat.title ?? String(chat.id))
    }
  }

  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const userId = event.pathParameters?.userId
    if (!userId) return text(404, 'not found')
    const settings = await deps.store.getSettings(userId)
    const expected = settings?.telegram.webhookSecret
    const provided = event.headers['x-telegram-bot-api-secret-token'] ?? ''
    if (!settings || !expected || !safeEqual(provided, expected)) {
      deps.log.warn('webhook.forbidden', { userId })
      return text(403, 'forbidden')
    }
    let update: TgUpdate
    try { update = JSON.parse(event.body ?? '{}') as TgUpdate } catch { return text(400, 'bad json') }
    try {
      await handleUpdate(userId, settings, update)
    } catch (e) {
      // Always 200 to Telegram; otherwise it retries the same update indefinitely.
      deps.log.error('webhook.failed', { userId, err: e })
    }
    return text(200, 'ok')
  }
}
```

`apps/lambdas/src/tg-webhook/index.ts`:
```ts
import { buildCoreDeps } from '../shared/deps'
import { createWebhookHandler } from './handler'

const deps = buildCoreDeps('tg-webhook')
export const handler = createWebhookHandler({ store: deps.store, secrets: deps.secrets, createTelegram: deps.createTelegram, now: deps.now, log: deps.log })
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @gighunter/lambdas test -- tg-webhook && pnpm --filter @gighunter/lambdas typecheck`
Expected: pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(lambdas): Telegram webhook (feedback buttons, chat detection)"
```

---

### Task 18: API Lambda — app skeleton, auth, errors, `/me`, `/profile`, `/runs`

**Files:**
- Create: `apps/lambdas/src/api/{deps.ts,auth.ts,errors.ts,app.ts,index.ts}`, `apps/lambdas/src/api/routes/{profile.ts,runs.ts}`, `apps/lambdas/src/api/test-utils.ts`, `apps/lambdas/src/api/app.test.ts`, `apps/lambdas/src/api/routes/profile.test.ts`, `apps/lambdas/src/api/routes/runs.test.ts`

**Interfaces:**
- Consumes: `CoreDeps`, `buildCoreDeps`, `env` (Task 14); `Store`; `ServiceError`; `TelegramError`; schemas
- Produces:
  - `interface ApiDeps extends CoreDeps { apiBaseUrl: string; invokePoller: (userId: string) => Promise<void> }`
  - `type ApiEnv = { Bindings: { event: LambdaEvent }; Variables: { user: AuthUser } }`, `AuthUser = { sub: string; email: string }`
  - `claimsFrom(event: unknown): AuthUser | null`, `requireAuth` middleware
  - `class HttpError extends Error { status: number; code?: string }`, `errorHandler(log: Logger): ErrorHandler<ApiEnv>`
  - `createApp(deps: ApiDeps): Hono<ApiEnv>`; route factories `profileRoutes(deps)`, `runsRoutes(deps)` (later tasks add `settingsRoutes`, `promptsRoutes`, `matchesRoutes`)
  - test helper `makeApiDeps(overrides?)` and `authed(sub?, email?)` env in `test-utils.ts`

- [ ] **Step 1: Test utilities and failing tests**

`apps/lambdas/src/api/test-utils.ts`:
```ts
import { vi } from 'vitest'
import { createLogger } from '@gighunter/core/logger'
import type { ApiDeps } from './deps'

export function makeApiDeps(overrides: Partial<Record<keyof ApiDeps, unknown>> & { store?: Record<string, unknown> } = {}): ApiDeps {
  const store = {
    getProfile: vi.fn().mockResolvedValue(null), putProfile: vi.fn(),
    getSettings: vi.fn().mockResolvedValue(null), putSettings: vi.fn(),
    getPrompts: vi.fn().mockResolvedValue(null), putPrompts: vi.fn(),
    getMatch: vi.fn().mockResolvedValue(null), listMatches: vi.fn().mockResolvedValue({ items: [] }), setMatchFeedback: vi.fn().mockResolvedValue(null),
    getChat: vi.fn().mockResolvedValue(null), putChat: vi.fn(), deleteChat: vi.fn(),
    listRuns: vi.fn().mockResolvedValue([]), putRun: vi.fn(), listActiveUsers: vi.fn().mockResolvedValue([]), existingMatchKeys: vi.fn(), putMatch: vi.fn(), updateMatchStatus: vi.fn(),
    ...(overrides.store ?? {}),
  }
  const { store: _s, ...rest } = overrides
  return {
    store: store as never,
    secrets: { getUserSecret: vi.fn().mockResolvedValue(null), putUserSecret: vi.fn(), deleteUserSecret: vi.fn(), getAllowedEmails: vi.fn(), userParamName: vi.fn() } as never,
    sources: { freelancer: { platform: 'freelancer', fetchRecent: vi.fn(), verifyToken: vi.fn() }, upwork: { platform: 'upwork', fetchRecent: vi.fn(), verifyToken: vi.fn() } } as never,
    createLlm: vi.fn(),
    createTelegram: vi.fn(),
    now: () => new Date('2026-09-20T10:00:00.000Z'),
    log: createLogger({}, () => {}),
    apiBaseUrl: 'https://api.test',
    invokePoller: vi.fn().mockResolvedValue(undefined),
    ...(rest as Partial<ApiDeps>),
  }
}

export const authed = (sub = 'u1', email = 'me@example.com') => ({ event: { requestContext: { authorizer: { jwt: { claims: { sub, email } } } } } })
export const anonymous = () => ({ event: { requestContext: {} } })
export const json = (body: unknown, method = 'POST') => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
```

`apps/lambdas/src/api/app.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createApp } from './app'
import { makeApiDeps, authed, anonymous } from './test-utils'

describe('app', () => {
  it('401 without JWT claims', async () => {
    const res = await createApp(makeApiDeps()).request('/me', {}, anonymous())
    expect(res.status).toBe(401)
  })
  it('/me returns sub and email from claims', async () => {
    const res = await createApp(makeApiDeps()).request('/me', {}, authed('abc', 'a@b.c'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sub: 'abc', email: 'a@b.c' })
  })
  it('404 JSON for unknown routes', async () => {
    const res = await createApp(makeApiDeps()).request('/nope', {}, authed())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not found' })
  })
})
```

`apps/lambdas/src/api/routes/profile.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createApp } from '../app'
import { makeApiDeps, authed, json } from '../test-utils'

const input = { displayName: 'Yev', skills: [{ name: 'TS', level: 'expert' }], budget: { min: 50, max: 500, currency: 'USD' }, maxHours: 6, languages: ['en'], stopWords: [], freeText: '' }

describe('/profile', () => {
  it('GET 404 when missing, 200 when present', async () => {
    const deps = makeApiDeps()
    expect((await createApp(deps).request('/profile', {}, authed())).status).toBe(404)
    ;(deps.store.getProfile as ReturnType<typeof import('vitest')['vi']['fn']>).mockResolvedValue({ ...input, updatedAt: 'x' })
    expect((await createApp(deps).request('/profile', {}, authed())).status).toBe(200)
  })
  it('PUT validates, stamps updatedAt and stores under the JWT sub', async () => {
    const deps = makeApiDeps()
    const res = await createApp(deps).request('/profile', json(input, 'PUT'), authed('sub-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ...input, updatedAt: '2026-09-20T10:00:00.000Z' })
    expect(deps.store.putProfile).toHaveBeenCalledWith('sub-1', body)
  })
  it('PUT 400 with issues on invalid body', async () => {
    const res = await createApp(makeApiDeps()).request('/profile', json({ ...input, maxHours: -1 }, 'PUT'), authed())
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'validation_failed', issues: expect.any(Array) })
  })
})
```

`apps/lambdas/src/api/routes/runs.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createApp } from '../app'
import { makeApiDeps, authed } from '../test-utils'

describe('/runs', () => {
  it('GET lists runs with limit capped at 50', async () => {
    const deps = makeApiDeps()
    await createApp(deps).request('/runs?limit=500', {}, authed('s'))
    expect(deps.store.listRuns).toHaveBeenCalledWith('s', 50)
    await createApp(deps).request('/runs', {}, authed('s'))
    expect(deps.store.listRuns).toHaveBeenLastCalledWith('s', 10)
  })
  it('POST invokes the poller for the caller and returns 202', async () => {
    const deps = makeApiDeps()
    const res = await createApp(deps).request('/runs', { method: 'POST' }, authed('s'))
    expect(res.status).toBe(202)
    expect(deps.invokePoller).toHaveBeenCalledWith('s')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @gighunter/lambdas test -- api`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement**

`apps/lambdas/src/api/deps.ts`:
```ts
import type { CoreDeps } from '../shared/deps'

export interface ApiDeps extends CoreDeps {
  apiBaseUrl: string
  invokePoller: (userId: string) => Promise<void>
}
```

`apps/lambdas/src/api/auth.ts`:
```ts
import type { MiddlewareHandler } from 'hono'
import type { LambdaEvent } from 'hono/aws-lambda'

export interface AuthUser { sub: string; email: string }
export type ApiEnv = { Bindings: { event: LambdaEvent }; Variables: { user: AuthUser } }

/** Reads Cognito claims injected by the API Gateway JWT authorizer. Never trust anything else for identity. */
export function claimsFrom(event: unknown): AuthUser | null {
  const claims = (event as { requestContext?: { authorizer?: { jwt?: { claims?: Record<string, unknown> } } } })?.requestContext?.authorizer?.jwt?.claims
  const sub = claims?.sub
  if (typeof sub !== 'string' || !sub) return null
  return { sub, email: typeof claims?.email === 'string' ? claims.email : '' }
}

export const requireAuth: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const user = claimsFrom(c.env?.event)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  c.set('user', user)
  await next()
}
```

`apps/lambdas/src/api/errors.ts`:
```ts
import type { ErrorHandler } from 'hono'
import { ZodError } from 'zod'
import type { Logger } from '@gighunter/core/logger'
import { TelegramError } from '@gighunter/core/notifier'
import { ServiceError } from '@gighunter/core/services'
import type { ApiEnv } from './auth'

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message)
    this.name = 'HttpError'
  }
}

export function errorHandler(log: Logger): ErrorHandler<ApiEnv> {
  return (err, c) => {
    if (err instanceof ZodError) return c.json({ error: 'validation_failed', issues: err.issues }, 400)
    if (err instanceof ServiceError) return c.json({ error: err.message, code: err.code }, err.status as 400)
    if (err instanceof HttpError) return c.json({ error: err.message, code: err.code }, err.status as 400)
    if (err instanceof TelegramError) return c.json({ error: err.message, code: 'telegram_error' }, 400)
    if (err instanceof SyntaxError) return c.json({ error: 'invalid JSON body' }, 400)
    log.error('api.unhandled', { err, path: c.req.path })
    return c.json({ error: 'internal error' }, 500)
  }
}
```

`apps/lambdas/src/api/routes/profile.ts`:
```ts
import { Hono } from 'hono'
import { ProfileInputSchema } from '@gighunter/core/schema'
import type { ApiEnv } from '../auth'
import type { ApiDeps } from '../deps'

export function profileRoutes(deps: ApiDeps) {
  const r = new Hono<ApiEnv>()
  r.get('/profile', async (c) => {
    const profile = await deps.store.getProfile(c.get('user').sub)
    return profile ? c.json(profile) : c.json({ error: 'profile not set', code: 'profile_missing' }, 404)
  })
  r.put('/profile', async (c) => {
    const input = ProfileInputSchema.parse(await c.req.json())
    const profile = { ...input, updatedAt: deps.now().toISOString() }
    await deps.store.putProfile(c.get('user').sub, profile)
    return c.json(profile)
  })
  return r
}
```

`apps/lambdas/src/api/routes/runs.ts`:
```ts
import { Hono } from 'hono'
import type { ApiEnv } from '../auth'
import type { ApiDeps } from '../deps'

export function runsRoutes(deps: ApiDeps) {
  const r = new Hono<ApiEnv>()
  r.get('/runs', async (c) => {
    const requested = Number(c.req.query('limit') ?? 10)
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(50, Math.floor(requested)) : 10
    return c.json(await deps.store.listRuns(c.get('user').sub, limit))
  })
  r.post('/runs', async (c) => {
    await deps.invokePoller(c.get('user').sub)
    return c.json({ status: 'queued' }, 202)
  })
  return r
}
```

`apps/lambdas/src/api/app.ts`:
```ts
import { Hono } from 'hono'
import { requireAuth, type ApiEnv } from './auth'
import type { ApiDeps } from './deps'
import { errorHandler } from './errors'
import { profileRoutes } from './routes/profile'
import { runsRoutes } from './routes/runs'

export function createApp(deps: ApiDeps) {
  const app = new Hono<ApiEnv>()
  app.onError(errorHandler(deps.log))
  app.notFound((c) => c.json({ error: 'not found' }, 404))
  app.use('*', requireAuth)
  app.get('/me', (c) => c.json(c.get('user')))
  app.route('/', profileRoutes(deps))
  app.route('/', runsRoutes(deps))
  return app
}
```

`apps/lambdas/src/api/index.ts`:
```ts
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import { handle } from 'hono/aws-lambda'
import { buildCoreDeps, env } from '../shared/deps'
import { createApp } from './app'
import type { ApiDeps } from './deps'

const core = buildCoreDeps('api')
const lambda = new LambdaClient({ region: process.env.AWS_REGION ?? 'us-east-1' })

const deps: ApiDeps = {
  ...core,
  apiBaseUrl: env('API_BASE_URL'),
  invokePoller: async (userId) => {
    await lambda.send(new InvokeCommand({
      FunctionName: env('POLLER_FUNCTION_NAME'),
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ trigger: 'manual', userId })),
    }))
  },
}

export const handler = handle(createApp(deps))
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @gighunter/lambdas test -- api && pnpm --filter @gighunter/lambdas typecheck`
Expected: pass. Note: `app.request(path, init, env)` — the third argument is the Hono env (bindings); if the installed Hono version reads `c.env` differently, check `node_modules/hono/dist/types/hono-base.d.ts` for the `request` signature.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): Hono app with JWT auth, error mapping, profile and runs routes"
```

---

### Task 19: API — settings and token routes

**Files:**
- Create: `apps/lambdas/src/api/routes/settings.ts`, `apps/lambdas/src/api/routes/settings.test.ts`
- Modify: `apps/lambdas/src/api/app.ts`

**Interfaces:**
- Consumes: `SettingsSchema`, `SettingsPatchSchema`, `defaultSettings`; `connectTelegramBot`, `disconnectTelegramBot`, `sendTelegramTest`, `connectFreelancer`, `disconnectFreelancer` (Task 12)
- Produces: `settingsRoutes(deps)`, `maskSettings(settings): PublicSettings` (drops `telegram.webhookSecret`)

- [ ] **Step 1: Failing tests**

`apps/lambdas/src/api/routes/settings.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createApp } from '../app'
import { makeApiDeps, authed, json } from '../test-utils'
import { defaultSettings } from '@gighunter/core/schema'
import { TelegramError } from '@gighunter/core/notifier'

const nowIso = '2026-09-20T10:00:00.000Z'

describe('/settings', () => {
  it('GET returns defaults when nothing stored and never exposes webhookSecret', async () => {
    const deps = makeApiDeps({ store: { getSettings: vi.fn().mockResolvedValue({ ...defaultSettings(nowIso), telegram: { tokenSet: true, webhookSecret: 'SECRET', chatId: '1' } }) } })
    const res = await createApp(deps).request('/settings', {}, authed())
    const body = await res.json()
    expect(body.telegram).toEqual({ tokenSet: true, chatId: '1' })
    expect(JSON.stringify(body)).not.toContain('SECRET')
    const empty = makeApiDeps()
    expect((await (await createApp(empty).request('/settings', {}, authed())).json()).notifyThreshold).toBe(70)
  })
  it('PATCH merges nested fields and rejects unknown keys', async () => {
    const deps = makeApiDeps({ store: { getSettings: vi.fn().mockResolvedValue({ ...defaultSettings(nowIso), platforms: { freelancer: { enabled: false, query: 'old', tokenSet: true, tokenHint: '1234', connectedAs: 'yev' }, upwork: { enabled: false } } }) } })
    const res = await createApp(deps).request('/settings', json({ notifyThreshold: 80, platforms: { freelancer: { enabled: true } }, telegram: { chatId: '-5' } }, 'PATCH'), authed('s'))
    expect(res.status).toBe(200)
    const saved = (deps.store.putSettings as ReturnType<typeof vi.fn>).mock.calls[0]![1]
    expect(saved.notifyThreshold).toBe(80)
    expect(saved.platforms.freelancer).toEqual({ enabled: true, query: 'old', tokenSet: true, tokenHint: '1234', connectedAs: 'yev' })
    expect(saved.telegram.chatId).toBe('-5')
    expect(saved.updatedAt).toBe(nowIso)
    expect((await createApp(deps).request('/settings', json({ telegram: { webhookSecret: 'x' } }, 'PATCH'), authed())).status).toBe(400)
  })
})

describe('/settings/telegram/token', () => {
  it('PUT connects the bot and returns masked settings', async () => {
    const tg = { getMe: vi.fn().mockResolvedValue({ id: 1, username: 'gh_bot' }), setWebhook: vi.fn() }
    const deps = makeApiDeps({ createTelegram: vi.fn().mockReturnValue(tg) })
    const res = await createApp(deps).request('/settings/telegram/token', json({ token: '123456:abcdefgh' }, 'PUT'), authed('s'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.telegram).toMatchObject({ tokenSet: true, botUsername: 'gh_bot', tokenHint: 'efgh' })
    expect(body.telegram.webhookSecret).toBeUndefined()
    expect(tg.setWebhook).toHaveBeenCalledWith('https://api.test/telegram/webhook/s', expect.any(String), expect.any(Array))
    expect(deps.secrets.putUserSecret).toHaveBeenCalledWith('s', 'telegram/bot-token', '123456:abcdefgh')
  })
  it('PUT maps Telegram rejection to 400', async () => {
    const tg = { getMe: vi.fn().mockRejectedValue(new TelegramError('telegram getMe failed: Unauthorized', 401)) }
    const deps = makeApiDeps({ createTelegram: vi.fn().mockReturnValue(tg) })
    const res = await createApp(deps).request('/settings/telegram/token', json({ token: '123456:abcdefgh' }, 'PUT'), authed())
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('telegram_error')
  })
  it('DELETE disconnects; POST /test sends or 400s', async () => {
    const tg = { deleteWebhook: vi.fn(), sendMessage: vi.fn().mockResolvedValue({ messageId: 1 }) }
    const deps = makeApiDeps({ createTelegram: vi.fn().mockReturnValue(tg), secrets: { getUserSecret: vi.fn().mockResolvedValue('tok'), deleteUserSecret: vi.fn(), putUserSecret: vi.fn() } })
    expect((await createApp(deps).request('/settings/telegram/token', { method: 'DELETE' }, authed())).status).toBe(200)
    expect(deps.secrets.deleteUserSecret).toHaveBeenCalledWith('u1', 'telegram/bot-token')
    expect((await createApp(deps).request('/settings/telegram/test', { method: 'POST' }, authed())).status).toBe(400)
    ;(deps.store.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ ...defaultSettings(nowIso), telegram: { tokenSet: true, chatId: '-1' } })
    expect((await createApp(deps).request('/settings/telegram/test', { method: 'POST' }, authed())).status).toBe(204)
  })
})

describe('/settings/freelancer/token', () => {
  it('PUT verifies with the adapter and stores; DELETE clears', async () => {
    const deps = makeApiDeps()
    ;(deps.sources.freelancer.verifyToken as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, username: 'yev' })
    const res = await createApp(deps).request('/settings/freelancer/token', json({ token: 'fl-token-1234' }, 'PUT'), authed('s'))
    expect(res.status).toBe(200)
    expect((await res.json()).platforms.freelancer).toMatchObject({ tokenSet: true, connectedAs: 'yev', tokenHint: '1234' })
    ;(deps.sources.freelancer.verifyToken as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'http_401' })
    expect((await createApp(deps).request('/settings/freelancer/token', json({ token: 'bad-token-1' }, 'PUT'), authed())).status).toBe(400)
    expect((await createApp(deps).request('/settings/freelancer/token', { method: 'DELETE' }, authed('s'))).status).toBe(200)
    expect(deps.secrets.deleteUserSecret).toHaveBeenCalledWith('s', 'freelancer/token')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gighunter/lambdas test -- settings`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`apps/lambdas/src/api/routes/settings.ts`:
```ts
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
```

In `apps/lambdas/src/api/app.ts` add `import { settingsRoutes } from './routes/settings'` and `app.route('/', settingsRoutes(deps))` after the profile route.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @gighunter/lambdas test -- api && pnpm --filter @gighunter/lambdas typecheck`
Expected: pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): settings, Telegram and Freelancer token routes"
```

---

### Task 20: API — prompts routes

**Files:**
- Create: `apps/lambdas/src/api/routes/prompts.ts`, `apps/lambdas/src/api/routes/prompts.test.ts`
- Modify: `apps/lambdas/src/api/app.ts`

**Interfaces:**
- Consumes: `PromptsPatchSchema`, `Prompts`; `DEFAULT_*`, `buildScoringSystemPrompt`, `buildChatSystemPrompt`, `SAMPLE_MATCH` (Task 3)
- Produces: `promptsRoutes(deps)`; response shape of `GET /prompts` = `{ defaults: { scoring, chat, quickActions }, overrides: Partial<Prompts>, placeholders: string[] }`

- [ ] **Step 1: Failing tests**

`apps/lambdas/src/api/routes/prompts.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createApp } from '../app'
import { makeApiDeps, authed, json } from '../test-utils'
import { DEFAULT_SCORING_PROMPT, DEFAULT_QUICK_ACTIONS } from '@gighunter/core/prompts'

const nowIso = '2026-09-20T10:00:00.000Z'
const profile = { displayName: 'Yev', skills: [], budget: { min: 1, max: 9, currency: 'USD' }, maxHours: 4, languages: ['en'], stopWords: [], freeText: 'about me', updatedAt: nowIso }

describe('/prompts', () => {
  it('GET returns defaults, overrides and placeholder list', async () => {
    const deps = makeApiDeps({ store: { getPrompts: vi.fn().mockResolvedValue({ scoring: 'mine', updatedAt: nowIso }) } })
    const body = await (await createApp(deps).request('/prompts', {}, authed())).json()
    expect(body.defaults.scoring).toBe(DEFAULT_SCORING_PROMPT)
    expect(body.defaults.quickActions).toEqual(DEFAULT_QUICK_ACTIONS)
    expect(body.overrides).toEqual({ scoring: 'mine', updatedAt: nowIso })
    expect(body.placeholders).toEqual(['{{app_context}}', '{{profile}}', '{{job}}', '{{score}}'])
  })
  it('PUT sets fields, null resets, unknown keys rejected', async () => {
    const deps = makeApiDeps({ store: { getPrompts: vi.fn().mockResolvedValue({ scoring: 'old', chat: 'oldchat', updatedAt: 'x' }) } })
    const res = await createApp(deps).request('/prompts', json({ scoring: null, quickActions: [{ label: 'A', text: 'do a' }] }, 'PUT'), authed('s'))
    expect(res.status).toBe(200)
    const saved = (deps.store.putPrompts as ReturnType<typeof vi.fn>).mock.calls[0]![1]
    expect(saved).toEqual({ chat: 'oldchat', quickActions: [{ label: 'A', text: 'do a' }], updatedAt: nowIso })
    expect((await createApp(deps).request('/prompts', json({ nope: 1 }, 'PUT'), authed())).status).toBe(400)
  })
  it('POST /preview renders with the real profile and the sample job', async () => {
    const deps = makeApiDeps({ store: { getProfile: vi.fn().mockResolvedValue(profile) } })
    const res = await createApp(deps).request('/prompts/preview', json({ kind: 'chat', template: 'X {{job}} Y' }), authed())
    const body = await res.json()
    expect(body.rendered).toContain('Fix Stripe webhook retries')
    expect(body.rendered).toContain('about me')
    const noProfile = makeApiDeps()
    expect((await createApp(noProfile).request('/prompts/preview', json({ kind: 'scoring', template: 't' }), authed())).status).toBe(400)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gighunter/lambdas test -- prompts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`apps/lambdas/src/api/routes/prompts.ts`:
```ts
import { Hono } from 'hono'
import { z } from 'zod'
import { buildChatSystemPrompt, buildScoringSystemPrompt, DEFAULT_CHAT_PROMPT, DEFAULT_QUICK_ACTIONS, DEFAULT_SCORING_PROMPT, SAMPLE_MATCH } from '@gighunter/core/prompts'
import { PromptsPatchSchema, type Prompts } from '@gighunter/core/schema'
import type { ApiEnv } from '../auth'
import type { ApiDeps } from '../deps'
import { HttpError } from '../errors'

const PLACEHOLDERS = ['{{app_context}}', '{{profile}}', '{{job}}', '{{score}}']
const PreviewBody = z.object({ kind: z.enum(['scoring', 'chat']), template: z.string().max(8000) })

export function promptsRoutes(deps: ApiDeps) {
  const r = new Hono<ApiEnv>()

  r.get('/prompts', async (c) => {
    const overrides = (await deps.store.getPrompts(c.get('user').sub)) ?? {}
    return c.json({
      defaults: { scoring: DEFAULT_SCORING_PROMPT, chat: DEFAULT_CHAT_PROMPT, quickActions: DEFAULT_QUICK_ACTIONS },
      overrides,
      placeholders: PLACEHOLDERS,
    })
  })

  r.put('/prompts', async (c) => {
    const sub = c.get('user').sub
    const patch = PromptsPatchSchema.parse(await c.req.json())
    const current: Prompts = (await deps.store.getPrompts(sub)) ?? { updatedAt: deps.now().toISOString() }
    const next: Prompts = { ...current, updatedAt: deps.now().toISOString() }
    for (const key of ['scoring', 'chat', 'quickActions'] as const) {
      const value = patch[key]
      if (value === undefined) continue
      if (value === null) delete next[key]
      else (next as Record<string, unknown>)[key] = value
    }
    await deps.store.putPrompts(sub, next)
    return c.json(next)
  })

  r.post('/prompts/preview', async (c) => {
    const { kind, template } = PreviewBody.parse(await c.req.json())
    const profile = await deps.store.getProfile(c.get('user').sub)
    if (!profile) throw new HttpError(400, 'Fill in your profile first', 'profile_missing')
    const rendered = kind === 'scoring' ? buildScoringSystemPrompt(template, profile) : buildChatSystemPrompt(template, profile, SAMPLE_MATCH)
    return c.json({ rendered })
  })

  return r
}
```

In `app.ts` add `import { promptsRoutes } from './routes/prompts'` and `app.route('/', promptsRoutes(deps))`.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @gighunter/lambdas test -- api && pnpm --filter @gighunter/lambdas typecheck`
Expected: pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): prompts routes with reset and preview"
```

---

### Task 21: API — matches, feedback and chat routes

**Files:**
- Create: `apps/lambdas/src/api/routes/matches.ts`, `apps/lambdas/src/api/routes/matches.test.ts`
- Modify: `apps/lambdas/src/api/app.ts`

**Interfaces:**
- Consumes: `MatchStatusSchema`, `MatchRefSchema`, `FeedbackSchema`; `sendChatMessage` (Task 12)
- Produces: `matchesRoutes(deps)`; `GET /matches` → `MatchPage`; `GET /matches/:platform/:id` → `{ match, chat }`; `POST …/feedback` → `Match`; `POST …/chat` → `{ reply, truncated, usage }`; `DELETE …/chat` → 204

- [ ] **Step 1: Failing tests**

`apps/lambdas/src/api/routes/matches.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createApp } from '../app'
import { makeApiDeps, authed, json } from '../test-utils'
import { SAMPLE_MATCH } from '@gighunter/core/prompts'

const nowIso = '2026-09-20T10:00:00.000Z'
const profile = { displayName: 'Yev', skills: [], budget: { min: 1, max: 9, currency: 'USD' }, maxHours: 4, languages: ['en'], stopWords: [], freeText: '', updatedAt: nowIso }

describe('/matches', () => {
  it('GET defaults to notified, validates status, forwards cursor/limit', async () => {
    const deps = makeApiDeps()
    await createApp(deps).request('/matches', {}, authed('s'))
    expect(deps.store.listMatches).toHaveBeenCalledWith('s', 'notified', { limit: 50, cursor: undefined })
    await createApp(deps).request('/matches?status=filtered&limit=5&cursor=abc', {}, authed('s'))
    expect(deps.store.listMatches).toHaveBeenLastCalledWith('s', 'filtered', { limit: 5, cursor: 'abc' })
    expect((await createApp(deps).request('/matches?status=weird', {}, authed())).status).toBe(400)
  })
  it('GET /matches/:platform/:id returns match + chat or 404', async () => {
    const deps = makeApiDeps({ store: { getMatch: vi.fn().mockResolvedValue(SAMPLE_MATCH), getChat: vi.fn().mockResolvedValue(null) } })
    const res = await createApp(deps).request('/matches/freelancer/sample-1', {}, authed())
    expect(await res.json()).toEqual({ match: SAMPLE_MATCH, chat: null })
    expect((await createApp(makeApiDeps()).request('/matches/freelancer/nope', {}, authed())).status).toBe(404)
    expect((await createApp(makeApiDeps()).request('/matches/fiverr/1', {}, authed())).status).toBe(400)
  })
  it('POST feedback stores and returns the match', async () => {
    const deps = makeApiDeps({ store: { setMatchFeedback: vi.fn().mockResolvedValue({ ...SAMPLE_MATCH, feedback: 'down' }) } })
    const res = await createApp(deps).request('/matches/freelancer/sample-1/feedback', json({ feedback: 'down' }), authed('s'))
    expect(res.status).toBe(200)
    expect(deps.store.setMatchFeedback).toHaveBeenCalledWith('s', { platform: 'freelancer', externalId: 'sample-1' }, 'down', nowIso)
    expect((await createApp(makeApiDeps()).request('/matches/freelancer/x/feedback', json({ feedback: 'up' }), authed())).status).toBe(404)
  })
  it('POST chat runs a turn; 404 when match missing; DELETE chat resets', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Draft!' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
    const deps = makeApiDeps({ store: { getMatch: vi.fn().mockResolvedValue(SAMPLE_MATCH), getProfile: vi.fn().mockResolvedValue(profile) }, createLlm: vi.fn().mockReturnValue({ messages: { create, parse: vi.fn() } }) })
    const res = await createApp(deps).request('/matches/freelancer/sample-1/chat', json({ message: 'Draft a proposal' }), authed('s'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ reply: 'Draft!', truncated: false, usage: { inputTokens: 10, outputTokens: 5 } })
    expect(deps.store.putChat).toHaveBeenCalled()
    expect((await createApp(deps).request('/matches/freelancer/sample-1/chat', json({ message: '' }), authed())).status).toBe(400)
    expect((await createApp(makeApiDeps()).request('/matches/freelancer/zzz/chat', json({ message: 'x' }), authed())).status).toBe(404)
    const del = await createApp(deps).request('/matches/freelancer/sample-1/chat', { method: 'DELETE' }, authed('s'))
    expect(del.status).toBe(204)
    expect(deps.store.deleteChat).toHaveBeenCalledWith('s', { platform: 'freelancer', externalId: 'sample-1' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gighunter/lambdas test -- matches`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`apps/lambdas/src/api/routes/matches.ts`:
```ts
import { Hono } from 'hono'
import { z } from 'zod'
import { FeedbackSchema, MatchRefSchema, MatchStatusSchema } from '@gighunter/core/schema'
import { sendChatMessage } from '@gighunter/core/services'
import type { ApiEnv } from '../auth'
import type { ApiDeps } from '../deps'
import { HttpError } from '../errors'

const ListQuery = z.object({
  status: MatchStatusSchema.default('notified'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
})
const FeedbackBody = z.object({ feedback: FeedbackSchema })
const ChatBody = z.object({ message: z.string().trim().min(1).max(4000) })

export function matchesRoutes(deps: ApiDeps) {
  const r = new Hono<ApiEnv>()
  const refOf = (c: { req: { param: (k: string) => string | undefined } }) =>
    MatchRefSchema.parse({ platform: c.req.param('platform'), externalId: c.req.param('id') })

  r.get('/matches', async (c) => {
    const q = ListQuery.parse(c.req.query())
    return c.json(await deps.store.listMatches(c.get('user').sub, q.status, { limit: q.limit, cursor: q.cursor }))
  })

  r.get('/matches/:platform/:id', async (c) => {
    const sub = c.get('user').sub
    const ref = refOf(c)
    const match = await deps.store.getMatch(sub, ref)
    if (!match) throw new HttpError(404, 'Job not found', 'match_not_found')
    const chat = await deps.store.getChat(sub, ref)
    return c.json({ match, chat })
  })

  r.post('/matches/:platform/:id/feedback', async (c) => {
    const { feedback } = FeedbackBody.parse(await c.req.json())
    const match = await deps.store.setMatchFeedback(c.get('user').sub, refOf(c), feedback, deps.now().toISOString())
    if (!match) throw new HttpError(404, 'Job not found', 'match_not_found')
    return c.json(match)
  })

  r.post('/matches/:platform/:id/chat', async (c) => {
    const { message } = ChatBody.parse(await c.req.json())
    const { reply, truncated, usage } = await sendChatMessage(deps, c.get('user').sub, refOf(c), message)
    return c.json({ reply, truncated, usage })
  })

  r.delete('/matches/:platform/:id/chat', async (c) => {
    await deps.store.deleteChat(c.get('user').sub, refOf(c))
    return c.body(null, 204)
  })

  return r
}
```

In `app.ts` add `import { matchesRoutes } from './routes/matches'` and `app.route('/', matchesRoutes(deps))`.

- [ ] **Step 4: Run all lambdas tests + typecheck + full build**

Run: `pnpm --filter @gighunter/lambdas test && pnpm --filter @gighunter/lambdas typecheck && pnpm build && ls -la apps/lambdas/dist/*/index.mjs`
Expected: all pass; four bundles listed. If esbuild reports a resolution error for `@anthropic-ai/sdk/helpers/zod` or `hono/aws-lambda`, check the package's `exports` map and adjust the import path.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): matches feed, detail, feedback and per-job chat routes"
```

---

### Task 22: Local scripts (seed user, run poller locally, probe Freelancer)

**Files:**
- Create: `scripts/seed-user.ts`, `scripts/poller-local.ts`, `scripts/freelancer-probe.ts`, `scripts/seed.example.json`
- Modify: `package.json` (root: add workspace deps), `apps/lambdas/package.json` (export `./deps`), `.gitignore`

**Interfaces:**
- Consumes: `buildCoreDeps`, `env` (Task 14, exported as `@gighunter/lambdas/deps`); services (Task 12); `runForUser` (Task 13); `FreelancerSource` (Task 11)
- Produces: CLI entry points wired in root `package.json` scripts (`seed:user`, `poller:local`, `freelancer:probe`). No unit tests — these are operator tools verified in Task 27.

- [ ] **Step 1: Package wiring**

In `apps/lambdas/package.json` add:
```json
"exports": { "./deps": "./src/shared/deps.ts" },
```

In root `package.json` add:
```json
"dependencies": {
  "@gighunter/core": "workspace:*",
  "@gighunter/lambdas": "workspace:*",
  "zod": "^4.6.0"
}
```

Append to `.gitignore`:
```
# local seed data (contains tokens)
seed*.json
!scripts/seed.example.json
# terraform build artifacts
infra/**/.build/
```

Run `pnpm install`.

- [ ] **Step 2: Scripts**

`scripts/seed.example.json`:
```json
{
  "sub": "smoke-test-user",
  "profile": {
    "displayName": "Yevhenii",
    "skills": [{ "name": "TypeScript", "level": "expert" }, { "name": "React", "level": "expert" }, { "name": "AWS", "level": "solid" }, { "name": "Node.js", "level": "expert" }],
    "budget": { "min": 50, "max": 600, "currency": "USD" },
    "maxHours": 6,
    "languages": ["en"],
    "stopWords": ["wordpress", "long term", "full-time"],
    "freeText": "Senior full-stack developer. Evenings only. I like small, well-scoped API integrations, bug fixes and automation scripts."
  },
  "settings": {
    "active": true,
    "notifyThreshold": 70,
    "platforms": { "freelancer": { "enabled": true, "query": "typescript react node" } }
  },
  "secrets": {
    "telegramBotToken": "123456789:paste-bot-token-here",
    "freelancerToken": "paste-freelancer-oauth-token-here"
  }
}
```

`scripts/seed-user.ts`:
```ts
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
```

`scripts/poller-local.ts`:
```ts
import { parseArgs } from 'node:util'
import { buildCoreDeps, env } from '@gighunter/lambdas/deps'
import { runForUser, type PipelineDeps } from '@gighunter/core/pipeline'
import type { Store } from '@gighunter/core/store'

const { values } = parseArgs({
  options: { user: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, trigger: { type: 'string', default: 'manual' } },
})
if (!values.user) throw new Error('usage: pnpm poller:local --user <sub> [--dry-run]')

const deps: PipelineDeps = { ...buildCoreDeps('poller-local'), appUrl: env('APP_URL') }

if (values['dry-run']) {
  const WRITE = /^(put|update|delete|set)/
  deps.store = new Proxy(deps.store, {
    get(target, prop) {
      const value = Reflect.get(target, prop)
      if (typeof value === 'function' && typeof prop === 'string' && WRITE.test(prop)) {
        return async (...args: unknown[]) => {
          console.log(`[dry-run] store.${prop}`, JSON.stringify(args[1] ?? args[0]).slice(0, 200))
          return prop === 'setMatchFeedback' ? null : undefined
        }
      }
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as Store
  deps.createTelegram = () =>
    ({
      sendMessage: async (chatId: string, text: string) => {
        console.log(`[dry-run] telegram → ${chatId}\n${text}\n`)
        return { messageId: 0 }
      },
    }) as never
}

const run = await runForUser(deps, values.user, values.trigger as 'manual' | 'schedule')
console.log(JSON.stringify(run, null, 2))
```

`scripts/freelancer-probe.ts`:
```ts
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
```

- [ ] **Step 3: Verify the scripts at least parse and resolve imports**

Run: `pnpm poller:local 2>&1 | head -3`
Expected: the usage error `usage: pnpm poller:local --user <sub> [--dry-run]` (proves tsx resolves `@gighunter/lambdas/deps` and core). Run `pnpm seed:user 2>&1 | head -3` → usage error. Run `pnpm freelancer:probe 2>&1 | head -3` → `set FREELANCER_TOKEN`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: local operator scripts (seed user, run poller, probe Freelancer)"
```

---

### Task 23: Terraform bootstrap (state bucket)

**Files:**
- Create: `infra/bootstrap/main.tf`, `infra/README.md`

- [ ] **Step 1: Write the bootstrap root**

`infra/bootstrap/main.tf`:
```hcl
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

variable "region" {

  type = string

  default = "us-east-1"

}
variable "aws_profile" {
  type = string
  default = "yevhenii"
}
variable "project" {
  type = string
  default = "gighunter"
}
provider "aws" {
  region  = var.region
  profile = var.aws_profile
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "state" {
  bucket = "${var.project}-tfstate-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

output "state_bucket" { value = aws_s3_bucket.state.bucket }
```

`infra/README.md`:
```markdown
# Infrastructure

Two Terraform roots, AWS profile `yevhenii`, region `us-east-1`.

## 1. Bootstrap (once)

Creates the S3 bucket that holds the main state.

```bash
cd infra/bootstrap
terraform init
terraform apply
# note the `state_bucket` output
```

Then write `infra/main/backend.hcl`:

```hcl
bucket = "gighunter-tfstate-<ACCOUNT_ID>"
```

## 2. Main

Prerequisites:

1. A Google OAuth client (Google Cloud Console → APIs & Services → Credentials → Create → OAuth client ID → Web application) with authorized redirect URI
   `https://gighunter-<ACCOUNT_ID>.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`.
2. `infra/main/terraform.tfvars` (git-ignored):

   ```hcl
   google_client_id     = "....apps.googleusercontent.com"
   google_client_secret = "..."
   alarm_email          = "you@example.com"
   allowed_emails       = ["you@example.com"]
   ```
3. Lambda bundles: `pnpm build` from the repo root.

```bash
cd infra/main
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

Confirm the SNS subscription email after the first apply. ACM validation can take a few minutes.

## Deploying changes

- Backend: `pnpm build && (cd infra/main && terraform apply)` — Terraform re-zips `apps/lambdas/dist/*` and updates functions whose hash changed.
- Frontend: `pnpm deploy:web` (added with the web plan) — syncs `apps/web/dist` to the web bucket and invalidates CloudFront.

## Destroy

`terraform destroy` in `infra/main` removes everything except the state bucket. The DynamoDB table has PITR on; export first if the data matters.
```

- [ ] **Step 2: Validate and plan**

Run: `cd infra/bootstrap && terraform init && terraform validate && terraform plan`
Expected: `Success! The configuration is valid.` and a plan with 4 resources to add.

- [ ] **Step 3: Apply (confirm with the user first)**

Ask the user to confirm creating the state bucket in the `yevhenii` account, then run: `cd infra/bootstrap && terraform apply -auto-approve` and record the `state_bucket` output. Write `infra/main/backend.hcl` with that bucket name (create the `infra/main` directory now).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "infra: terraform bootstrap for remote state"
```
(The bootstrap's local `terraform.tfstate` is git-ignored; it only tracks the bucket.)

---

### Task 24: Terraform main — providers, DynamoDB, IAM, Lambdas, scheduler

**Files:**
- Create: `infra/main/{providers.tf,variables.tf,locals.tf,dynamodb.tf,iam.tf,lambdas.tf,scheduler.tf,ssm.tf}`

**Interfaces:**
- Produces resources referenced by later tasks: `aws_dynamodb_table.main`, `aws_lambda_function.{poller,api,tg_webhook,pre_signup}`, `aws_iam_role.*`, `local.app_url`, `local.account_id`, `local.ssm_prefix`, `local.cognito_domain_prefix`. Task 25 defines `aws_apigatewayv2_api.main` and `aws_cognito_*` which `lambdas.tf` references for the api Lambda's env — the plan for this task therefore validates only after Task 25; run `terraform validate` at the end of Task 25.

- [ ] **Step 1: Write the files**

`infra/main/providers.tf`:
```hcl
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.7" }
  }
  backend "s3" {
    key          = "main/terraform.tfstate"
    region       = "us-east-1"
    profile      = "yevhenii"
    use_lockfile = true
    # bucket comes from backend.hcl (terraform init -backend-config=backend.hcl)
  }
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile
  default_tags {
    tags = { Project = var.project, ManagedBy = "terraform" }
  }
}
```

`infra/main/variables.tf`:
```hcl
variable "project" {
  type = string
  default = "gighunter"
}
variable "aws_profile" {
  type = string
  default = "yevhenii"
}
variable "region" {
  type = string
  default = "us-east-1"
}
variable "domain_name" {
  type = string
  default = "gighunter.onlytools.click"
}
variable "hosted_zone_name" {
  type = string
  default = "onlytools.click"
}
variable "lambda_dist_dir" {
  type = string
  default = "../../apps/lambdas/dist"
}
variable "dev_origins" {
  type = list(string)
  default = ["http://localhost:5173"]
}
variable "google_client_id"     { type = string }
variable "google_client_secret" {
  type = string
  sensitive = true
}
variable "alarm_email"          { type = string }
variable "allowed_emails" {
  type = list(string)
  description = "Emails allowed to sign up (Cognito pre-sign-up allowlist)"
}
```

`infra/main/locals.tf`:
```hcl
data "aws_caller_identity" "current" {}

locals {
  account_id            = data.aws_caller_identity.current.account_id
  app_url               = "https://${var.domain_name}"
  ssm_prefix            = "/${var.project}"
  lambda_names          = ["poller", "api", "tg-webhook", "pre-signup"]
  cognito_domain_prefix = "${var.project}-${local.account_id}"
  poller_arn            = "arn:aws:lambda:${var.region}:${local.account_id}:function:${var.project}-poller"
}
```

`infra/main/dynamodb.tf`:
```hcl
resource "aws_dynamodb_table" "main" {
  name         = var.project
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {

    name = "pk"

    type = "S"

  }
  attribute {
    name = "sk"
    type = "S"
  }
  attribute {
    name = "gsi1pk"
    type = "S"
  }
  attribute {
    name = "gsi1sk"
    type = "S"
  }
  attribute {
    name = "gsi2pk"
    type = "S"
  }
  attribute {
    name = "gsi2sk"
    type = "S"
  }
  global_secondary_index {
    name            = "gsi1"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "KEYS_ONLY"
  }

  global_secondary_index {
    name            = "gsi2"
    hash_key        = "gsi2pk"
    range_key       = "gsi2sk"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery { enabled = true }
}
```

`infra/main/iam.tf`:
```hcl
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

locals {
  table_arns    = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"]
  ssm_users_arn = "arn:aws:ssm:${var.region}:${local.account_id}:parameter${local.ssm_prefix}/users/*"
  ssm_auth_arn  = "arn:aws:ssm:${var.region}:${local.account_id}:parameter${local.ssm_prefix}/auth/*"
  bedrock_arns = [
    "arn:aws:bedrock:*::foundation-model/anthropic.*",
    "arn:aws:bedrock:*:${local.account_id}:inference-profile/*anthropic*",
  ]
  ddb_rw = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query", "dynamodb:BatchGetItem"]
}

data "aws_iam_policy_document" "poller" {
  statement {
    actions = local.ddb_rw
    resources = local.table_arns
  }
  statement {
    actions = ["ssm:GetParameter"]
    resources = [local.ssm_users_arn]
  }
  statement {
    actions = ["bedrock:InvokeModel"]
    resources = local.bedrock_arns
  }
}

data "aws_iam_policy_document" "api" {
  statement {
    actions = concat(local.ddb_rw, ["dynamodb:DeleteItem"])
    resources = local.table_arns
  }
  statement {
    actions = ["ssm:GetParameter", "ssm:PutParameter", "ssm:DeleteParameter"]
    resources = [local.ssm_users_arn]
  }
  statement {
    actions = ["bedrock:InvokeModel"]
    resources = local.bedrock_arns
  }
  statement {
    actions = ["lambda:InvokeFunction"]
    resources = [local.poller_arn]
  }
}

data "aws_iam_policy_document" "tg_webhook" {
  statement {
    actions = local.ddb_rw
    resources = local.table_arns
  }
  statement {
    actions = ["ssm:GetParameter"]
    resources = [local.ssm_users_arn]
  }
}

data "aws_iam_policy_document" "pre_signup" {
  statement {
    actions = ["ssm:GetParameter"]
    resources = [local.ssm_auth_arn]
  }
}

locals {
  roles = {
    poller     = data.aws_iam_policy_document.poller.json
    api        = data.aws_iam_policy_document.api.json
    tg_webhook = data.aws_iam_policy_document.tg_webhook.json
    pre_signup = data.aws_iam_policy_document.pre_signup.json
  }
}

resource "aws_iam_role" "fn" {
  for_each           = local.roles
  name               = "${var.project}-${replace(each.key, "_", "-")}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "fn_logs" {
  for_each   = local.roles
  role       = aws_iam_role.fn[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "fn" {
  for_each = local.roles
  name     = "inline"
  role     = aws_iam_role.fn[each.key].id
  policy   = each.value
}
```

`infra/main/lambdas.tf`:
```hcl
data "archive_file" "fn" {
  for_each    = toset(local.lambda_names)
  type        = "zip"
  source_dir  = "${path.module}/${var.lambda_dist_dir}/${each.key}"
  output_path = "${path.module}/.build/${each.key}.zip"
}

resource "aws_cloudwatch_log_group" "fn" {
  for_each          = toset(local.lambda_names)
  name              = "/aws/lambda/${var.project}-${each.key}"
  retention_in_days = 14
}

resource "aws_lambda_function" "poller" {
  function_name                  = "${var.project}-poller"
  role                           = aws_iam_role.fn["poller"].arn
  handler                        = "index.handler"
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  filename                       = data.archive_file.fn["poller"].output_path
  source_code_hash               = data.archive_file.fn["poller"].output_base64sha256
  timeout                        = 300
  memory_size                    = 512
  reserved_concurrent_executions = 1
  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.main.name
      SSM_PREFIX = local.ssm_prefix
      APP_URL    = local.app_url
    }
  }
  depends_on = [aws_cloudwatch_log_group.fn]
}

resource "aws_lambda_function" "api" {
  function_name    = "${var.project}-api"
  role             = aws_iam_role.fn["api"].arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  filename         = data.archive_file.fn["api"].output_path
  source_code_hash = data.archive_file.fn["api"].output_base64sha256
  timeout          = 29
  memory_size      = 512
  environment {
    variables = {
      TABLE_NAME           = aws_dynamodb_table.main.name
      SSM_PREFIX           = local.ssm_prefix
      API_BASE_URL         = aws_apigatewayv2_api.main.api_endpoint
      POLLER_FUNCTION_NAME = "${var.project}-poller"
    }
  }
  depends_on = [aws_cloudwatch_log_group.fn]
}

resource "aws_lambda_function" "tg_webhook" {
  function_name    = "${var.project}-tg-webhook"
  role             = aws_iam_role.fn["tg_webhook"].arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  filename         = data.archive_file.fn["tg-webhook"].output_path
  source_code_hash = data.archive_file.fn["tg-webhook"].output_base64sha256
  timeout          = 15
  memory_size      = 256
  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.main.name
      SSM_PREFIX = local.ssm_prefix
    }
  }
  depends_on = [aws_cloudwatch_log_group.fn]
}

resource "aws_lambda_function" "pre_signup" {
  function_name    = "${var.project}-pre-signup"
  role             = aws_iam_role.fn["pre_signup"].arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  filename         = data.archive_file.fn["pre-signup"].output_path
  source_code_hash = data.archive_file.fn["pre-signup"].output_base64sha256
  timeout          = 10
  memory_size      = 256
  environment {
    variables = { SSM_PREFIX = local.ssm_prefix }
  }
  depends_on = [aws_cloudwatch_log_group.fn]
}
```

`infra/main/scheduler.tf`:
```hcl
data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "scheduler_invoke" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.poller.arn]
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${var.project}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

resource "aws_iam_role_policy" "scheduler" {
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler_invoke.json
}

resource "aws_scheduler_schedule" "poller" {
  name                = "${var.project}-poller"
  schedule_expression = "rate(15 minutes)"
  flexible_time_window { mode = "OFF" }
  target {
    arn      = aws_lambda_function.poller.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ trigger = "schedule" })
  }
}
```

`infra/main/ssm.tf`:
```hcl
# Allowlist for the Cognito pre-sign-up trigger. Edited later with `aws ssm put-parameter --overwrite`;
# Terraform ignores value drift so operators can add people without a plan/apply.
resource "aws_ssm_parameter" "allowed_emails" {
  name  = "${local.ssm_prefix}/auth/allowed-emails"
  type  = "SecureString"
  value = join(",", var.allowed_emails)
  lifecycle { ignore_changes = [value] }
}
```

- [ ] **Step 2: Format**

Run: `cd infra/main && terraform fmt`
Expected: files reformatted without errors (validation waits for Task 25, which adds the API and Cognito resources these files reference).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "infra: DynamoDB table, IAM roles, Lambda functions, scheduler, allowlist parameter"
```

---

### Task 25: Terraform main — API Gateway and Cognito

**Files:**
- Create: `infra/main/{api.tf,cognito.tf}`

- [ ] **Step 1: Write the files**

`infra/main/api.tf`:
```hcl
resource "aws_apigatewayv2_api" "main" {
  name          = var.project
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = concat([local.app_url], var.dev_origins)
    allow_methods = ["GET", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.main.id
  name             = "cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  jwt_configuration {
    audience = [aws_cognito_user_pool_client.web.id]
    issuer   = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
  }
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "tg_webhook" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.tg_webhook.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "$default"
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "tg_webhook" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "POST /telegram/webhook/{userId}"
  target             = "integrations/${aws_apigatewayv2_integration.tg_webhook.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "tg_webhook" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.tg_webhook.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}
```

`infra/main/cognito.tf`:
```hcl
resource "aws_cognito_user_pool" "main" {
  name                     = var.project
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  lambda_config {
    pre_sign_up = aws_lambda_function.pre_signup.arn
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true
    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

resource "aws_lambda_permission" "cognito_pre_signup" {
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pre_signup.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}

resource "aws_cognito_identity_provider" "google" {
  user_pool_id  = aws_cognito_user_pool.main.id
  provider_name = "Google"
  provider_type = "Google"
  provider_details = {
    client_id        = var.google_client_id
    client_secret    = var.google_client_secret
    authorize_scopes = "openid email profile"
  }
  attribute_mapping = {
    email    = "email"
    username = "sub"
    name     = "name"
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name                                 = "web"
  user_pool_id                         = aws_cognito_user_pool.main.id
  generate_secret                      = false
  supported_identity_providers         = ["Google"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  callback_urls                        = concat(["${local.app_url}/login"], [for o in var.dev_origins : "${o}/login"])
  logout_urls                          = concat(["${local.app_url}/"], [for o in var.dev_origins : "${o}/"])
  prevent_user_existence_errors        = "ENABLED"
  access_token_validity                = 1
  id_token_validity                    = 1
  refresh_token_validity               = 30
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
  depends_on = [aws_cognito_identity_provider.google]
}

resource "aws_cognito_user_pool_domain" "main" {
  domain       = local.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.main.id
}
```

- [ ] **Step 2: Init and validate (still no DNS/web — validate only)**

Run: `cd infra/main && terraform init -backend-config=backend.hcl && terraform fmt && terraform validate`
Expected: `Success! The configuration is valid.` (If `backend.hcl` does not exist yet because Task 23 Step 3 was deferred, run `terraform init -backend=false` for validation only.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "infra: HTTP API with Cognito JWT authorizer, Cognito pool with Google IdP"
```

---

### Task 26: Terraform main — DNS, web hosting, monitoring, outputs

**Files:**
- Create: `infra/main/{dns.tf,web.tf,monitoring.tf,outputs.tf}`

- [ ] **Step 1: Write the files**

`infra/main/dns.tf`:
```hcl
data "aws_route53_zone" "main" {
  name = var.hosted_zone_name
}

resource "aws_acm_certificate" "web" {
  domain_name       = var.domain_name
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.web.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }
  zone_id         = data.aws_route53_zone.main.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "web" {
  certificate_arn         = aws_acm_certificate.web.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_route53_record" "web_a" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.domain_name
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "web_aaaa" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.domain_name
  type    = "AAAA"
  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}
```

`infra/main/web.tf`:
```hcl
resource "aws_s3_bucket" "web" {
  bucket = "${var.project}-web-${local.account_id}"
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.project}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = var.project
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  aliases             = [var.domain_name]

  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # AWS managed: CachingOptimized
  }

  # SPA fallback: unknown paths (S3 returns 403 for missing keys behind OAC) serve index.html.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.web.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

data "aws_iam_policy_document" "web_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web_bucket.json
}
```

`infra/main/monitoring.tf`:
```hcl
resource "aws_sns_topic" "alarms" {
  name = "${var.project}-alarms"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "poller_errors" {
  alarm_name          = "${var.project}-poller-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.poller.function_name }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}
```

`infra/main/outputs.tf`:
```hcl
output "api_url"                    { value = aws_apigatewayv2_api.main.api_endpoint }
output "app_url"                    { value = local.app_url }
output "cloudfront_domain"          { value = aws_cloudfront_distribution.web.domain_name }
output "cloudfront_distribution_id" { value = aws_cloudfront_distribution.web.id }
output "web_bucket"                 { value = aws_s3_bucket.web.bucket }
output "table_name"                 { value = aws_dynamodb_table.main.name }
output "poller_function_name"       { value = aws_lambda_function.poller.function_name }
output "cognito_user_pool_id"       { value = aws_cognito_user_pool.main.id }
output "cognito_client_id"          { value = aws_cognito_user_pool_client.web.id }
output "cognito_domain"             { value = "${aws_cognito_user_pool_domain.main.domain}.auth.${var.region}.amazoncognito.com" }
output "google_redirect_uri"        { value = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.region}.amazoncognito.com/oauth2/idpresponse" }
```

- [ ] **Step 2: Validate and plan**

Run: `cd infra/main && terraform fmt && terraform validate && terraform plan -out=tfplan | tail -40`
Expected: valid; plan lists ~45 resources to add, 0 to change/destroy. Requires `terraform.tfvars` (see `infra/README.md`) and built bundles in `apps/lambdas/dist`. If the plan errors on the Route53 data source, the `yevhenii` profile lacks Route53 read access — stop and report.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "infra: ACM + Route53 for gighunter.onlytools.click, CloudFront web hosting, alarms, outputs"
```

---

### Task 27: Deploy and end-to-end smoke test

**Files:**
- Create: `apps/web/public/index.html` (placeholder page until the web plan ships), `scripts/deploy-web.sh`
- Modify: `README.md`, `package.json` (add `deploy:web`)

- [ ] **Step 1: Placeholder page and deploy script**

`apps/web/public/index.html`:
```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>GigHunter</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#222}</style></head>
<body><h1>GigHunter</h1><p>Your evening-gig radar. The app is being built — check back soon.</p></body></html>
```

`scripts/deploy-web.sh`:
```bash
#!/usr/bin/env bash
# Syncs the built SPA (or the placeholder) to the web bucket and invalidates CloudFront.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:-apps/web/dist}"
[ -d "$SRC" ] || SRC="apps/web/public"
BUCKET=$(cd infra/main && terraform output -raw web_bucket)
DIST=$(cd infra/main && terraform output -raw cloudfront_distribution_id)
aws s3 sync "$SRC" "s3://$BUCKET" --delete --profile yevhenii
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" --profile yevhenii >/dev/null
echo "deployed $SRC → https://$(cd infra/main && terraform output -raw app_url | sed 's#https://##')"
```
`chmod +x scripts/deploy-web.sh`; add to root `package.json` scripts: `"deploy:web": "scripts/deploy-web.sh"`.

- [ ] **Step 2: Apply infrastructure (confirm with the user before each apply)**

1. Confirm `infra/main/terraform.tfvars` exists with Google client id/secret, `alarm_email`, `allowed_emails`.
2. `pnpm build`
3. `cd infra/main && terraform apply tfplan` (or `terraform apply`). ACM DNS validation typically completes in 2–10 minutes; CloudFront takes a few more.
4. `terraform output` — record `api_url`, `google_redirect_uri`, `cognito_domain`. Make sure the Google OAuth client's authorized redirect URI equals `google_redirect_uri`.
5. Confirm the SNS subscription from the email AWS sends.
6. `pnpm deploy:web` → open `https://gighunter.onlytools.click` — placeholder page loads over HTTPS.

- [ ] **Step 3: API smoke**

```bash
API=$(cd infra/main && terraform output -raw api_url)
curl -s -o /dev/null -w '%{http_code}\n' "$API/me"                       # expect 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/telegram/webhook/nobody" -d '{}'   # expect 403
```

- [ ] **Step 4: Seed a user and connect the bot**

Copy `scripts/seed.example.json` to `seed.local.json`, paste the real Telegram bot token (from @BotFather) and Freelancer token (Freelancer.com → Developers → create app → generate token), then:

```bash
export AWS_PROFILE=yevhenii AWS_REGION=us-east-1
export TABLE_NAME=$(cd infra/main && terraform output -raw table_name)
export APP_URL=$(cd infra/main && terraform output -raw app_url)
pnpm seed:user --file seed.local.json --api-url "$(cd infra/main && terraform output -raw api_url)"
```
Expected output: profile saved, settings saved, `telegram connected as @<bot>`, `freelancer connected as <username>`.

Send `/start` to the bot in Telegram (or add it as admin to a channel and post anything). Then:
```bash
aws dynamodb get-item --table-name "$TABLE_NAME" --key '{"pk":{"S":"USER#smoke-test-user"},"sk":{"S":"SETTINGS"}}' --query 'Item.telegram' --profile yevhenii
```
Expected: `chatId` and `chatTitle` populated (proves the webhook Lambda, secret check and chat detection work end to end).

- [ ] **Step 5: Run the pipeline locally, then in Lambda**

```bash
pnpm freelancer:probe --query "typescript react" --since-hours 48        # real API; adjust normalize.ts + fixture if fields differ
pnpm poller:local --user smoke-test-user --dry-run                        # scoring runs for real (Bedrock), nothing written/sent
pnpm poller:local --user smoke-test-user                                  # writes matches, sends Telegram messages
```
Expected: a JSON run summary with `perPlatform.freelancer.fetched > 0` and at least one Telegram message if anything scored ≥ threshold (lower `notifyThreshold` in the seed if nothing clears it). Press 👍 on a message — the keyboard changes to "✅ Marked useful" and `feedback: up` appears on the MATCH item.

If the first Bedrock call fails with a 400 mentioning `output_config`, apply the fallback from spec §9.1 (forced strict tool) in `scorer/scoreJob.ts` and re-run the core tests.

```bash
aws lambda invoke --function-name gighunter-poller --payload '{"trigger":"manual","userId":"smoke-test-user"}' --cli-binary-format raw-in-base64-out /dev/stdout --profile yevhenii
aws logs tail /aws/lambda/gighunter-poller --since 10m --profile yevhenii
```
Expected: `{"processed":1,"results":[{"userId":"smoke-test-user","errors":0}]}` and structured log lines `run.finish` with counts. Wait 15 minutes and confirm a scheduled run appears in the logs.

- [ ] **Step 6: README**

Update root `README.md` "Deploy" section to point at `infra/README.md` and add a "Smoke test" section with the commands from Steps 3–5. Update `seed.example.json` guidance if fields changed after the probe.

- [ ] **Step 7: Commit and push**

```bash
git add -A
git commit -m "chore: placeholder landing page, web deploy script, smoke-test docs"
git push
```

---

## Self-review notes

- **Spec coverage:** §5 data model → Tasks 2, 9; §6 pipeline → 13, 15; §7 adapters → 11; §8 filter → 4; §9.0 prompts → 3, 20; §9.1 scoring → 6; §9.2 chat → 7, 12, 21; §10 Telegram → 8, 12, 17; §11 UI → separate plan (placeholder page in 27); §12 API → 18–21; §13 auth → 16, 25; §14 secrets → 10, 24; §15 infra → 23–26; §16 errors → 13, 17, 18; §18 tests → every task; §19 cost → design only; §20 verifications → 27.
- **Deferred to the web plan:** all of §11 except the placeholder; `pnpm deploy:web` already works against `apps/web/dist` once it exists.
- **Type consistency checked:** `MatchRef` shape `{ platform, externalId }` is used by store, notifier, webhook and API; `Store.updateMatchStatus` patch is `{ status, telegramMessageId?, notifiedAt? }` in Tasks 9 and 13; `runForUser(deps, userId, trigger)` signature matches Tasks 13, 15 and 22; `buildCoreDeps` returns `Omit<PipelineDeps, 'appUrl'>` and every consumer adds `appUrl`/`apiBaseUrl` explicitly.
