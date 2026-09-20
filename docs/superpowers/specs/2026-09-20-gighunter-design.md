# GigHunter — Design Spec

**Date:** 2026-09-20
**Status:** Approved for implementation planning

## 1. Overview

GigHunter is a personal-first, multi-user-ready web app that watches freelance platforms for small "evening gigs" that match a developer's profile and pushes the good ones to that developer's Telegram bot with an AI-generated score and explanation.

A user configures a profile (structured skills + free text), connects their own platform API tokens and their own Telegram bot on a Settings page, and the system polls the platforms every 15 minutes, filters, scores each new job with Claude on Bedrock, and notifies.

### Goals

- Near-zero cost when idle (fully serverless, everything within AWS free tiers where possible).
- Fast reaction: new jobs reach Telegram within ~15 minutes of posting.
- Multi-user from day one in the data model, single user in v1 operations.
- Each user brings their own platform tokens and their own Telegram bot; the app holds no shared third-party secrets except Google OAuth for login.

### Non-goals (v1)

See §17.

## 2. Decisions

| Area | Decision |
|---|---|
| Platforms | Adapter interface. v1 implements **Freelancer.com** (open REST API). Upwork adapter stubbed until an API key is granted. |
| Matching strategy | Deterministic fetch → pre-filter → per-job LLM scoring. No autonomous agent loop. |
| LLM | **Amazon Bedrock**, Claude **Haiku 4.5** by default; model id is a per-user setting. |
| Pipeline orchestration | Single poller Lambda iterating over active users (monolithic pipeline). SQS fan-out deferred until >10 users or long runs. |
| Poll cadence | EventBridge Scheduler, every 15 minutes. |
| Frontend | TanStack Router + Vite SPA, static on S3 + CloudFront. TanStack Query, TanStack Form, Tailwind. |
| Auth | Cognito User Pool with Google identity provider; Pre-sign-up Lambda trigger enforcing an email allowlist. |
| API | API Gateway HTTP API + Cognito JWT authorizer → single Lambda running Hono. |
| Storage | One DynamoDB table (on-demand), single-table design, user-scoped partition keys. |
| Secrets | SSM Parameter Store SecureString (free) instead of Secrets Manager. |
| Infra | Terraform 1.16, AWS profile `yevhenii`, region `us-east-1`, S3 state backend with native lockfile. |
| Monorepo | pnpm workspaces, no Turborepo. esbuild for Lambda bundles. |
| Language | TypeScript everywhere. Node 22 on Lambda (arm64). |
| Docs | English. |

## 3. Architecture

```
                ┌─────────────┐
  EventBridge ──▶│   poller    │──▶ Freelancer API (v1)
   rate(15m)    │   Lambda    │──▶ Upwork GraphQL (v2)
                └──────┬──────┘
                       │ per active user: dedup / filter / score (Bedrock)
                       ▼
                 ┌───────────┐         ┌─────────────┐
                 │ DynamoDB  │◀───────▶│ api Lambda  │◀── API GW (HTTP) ◀── Cognito JWT
                 │ (1 table) │         │   (Hono)    │
                 └─────┬─────┘         └─────────────┘
                       │ notify                 ▲
                       ▼                        │ SPA (TanStack Router + Vite)
             user's Telegram bot           S3 + CloudFront
                       │
                       ▼ 👍👎 callbacks, /start, chat-member events
                 ┌─────────────┐
                 │ tg-webhook  │◀── API GW  POST /telegram/webhook/{userId}  (public, secret header)
                 │   Lambda    │
                 └─────────────┘

                 ┌─────────────┐
                 │ pre-signup  │◀── Cognito trigger (email allowlist)
                 │   Lambda    │
                 └─────────────┘
```

Four Lambdas, one table, one HTTP API, one CloudFront distribution, one Cognito pool.

## 4. Repository structure

```
gighunter/
├── apps/
│   ├── web/                    # TanStack Router + Vite SPA
│   │   └── src/routes/         # file-based routes: login, profile, settings, jobs
│   └── lambdas/                # thin handlers only; all logic lives in packages/core
│       ├── poller/
│       ├── api/
│       ├── tg-webhook/
│       └── pre-signup/
├── packages/
│   └── core/                   # domain logic; no HTTP/Lambda types in public interfaces
│       ├── schema/             # zod: Profile, Settings, Job, Match, Run, ScoreResult
│       ├── adapters/           # JobSource interface, freelancer/, upwork/ (stub)
│       ├── filter/             # deterministic pre-filter
│       ├── scorer/             # prompt builder + Bedrock client + response validation
│       ├── notifier/           # Telegram message formatter + Bot API client
│       ├── store/              # DynamoDB repository (the only module that knows pk/sk)
│       ├── secrets/            # SSM parameter read/write helpers
│       └── pipeline/           # runForUser(): wires the above together
├── infra/
│   ├── bootstrap/              # S3 state bucket; local state; applied once
│   └── main/                   # everything else; backend "s3" with use_lockfile
├── docs/
│   └── superpowers/specs/
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
└── README.md
```

`apps/web` imports zod schemas from `@gighunter/core/schema` so forms and API share one definition. Lambda handlers are bundled with esbuild into `apps/lambdas/dist/<name>/index.mjs`; Terraform zips them with `archive_file`.

## 5. Data model

One DynamoDB table, on-demand billing. Every user-owned item has `pk = USER#<cognitoSub>`.

| pk | sk | Item |
|---|---|---|
| `USER#<sub>` | `PROFILE` | Profile |
| `USER#<sub>` | `SETTINGS` | Settings (secrets are *not* stored here, only flags/hints) |
| `USER#<sub>` | `MATCH#<platform>#<externalId>` | Match: denormalized job + score + status + feedback |
| `USER#<sub>` | `RUN#<startedAtIso>` | Run: per-run stats and token usage |

Indexes:

- **GSI1** `gsi1pk`/`gsi1sk`: SETTINGS items carry `gsi1pk = ACTIVE_USER`, `gsi1sk = <sub>` when `active = true`. The poller queries this to enumerate users.
- **GSI2** `gsi2pk`/`gsi2sk`: MATCH items carry `gsi2pk = USER#<sub>`, `gsi2sk = <status>#<postedAt>`. Used by the Jobs feed (filter by status, newest first) and by the "retry unsent" step.

MATCH items have a `ttl` attribute = `createdAt + 60 days`. RUN items: `ttl = startedAt + 30 days`.

Jobs are denormalized into MATCH items rather than stored once in a shared `JOB#…` item. A shared job cache can be added later without migrating existing items.

### 5.1 Schemas (zod, in `packages/core/schema`)

```ts
Profile {
  displayName: string
  skills: { name: string; level: 'basic' | 'solid' | 'expert' }[]
  budget: { min: number; max: number; currency: 'USD' }   // acceptable fixed-price range per gig
  maxHours: number                                        // max effort per gig
  languages: string[]                                     // ISO 639-1, e.g. ['en', 'uk']
  stopWords: string[]                                     // case-insensitive, matched in title+description
  freeText: string                                        // "about me / what I'm looking for", ≤ 4000 chars
  updatedAt: string
}

Settings {
  active: boolean                    // poller processes this user
  notifyThreshold: number            // 0–100, default 70
  maxJobAgeHours: number             // ignore jobs older than this, default 24
  model: string                      // Bedrock model id, default 'anthropic.claude-haiku-4-5' (see §9)
  telegram: {
    tokenSet: boolean; tokenHint?: string     // last 4 chars of the bot token
    botUsername?: string
    webhookSecret?: string                    // random 32-byte hex, generated on token save
    chatId?: string; chatTitle?: string
  }
  platforms: {
    freelancer: { enabled: boolean; query: string; tokenSet: boolean; tokenHint?: string; connectedAs?: string }
    upwork:     { enabled: false }            // stub in v1
  }
  updatedAt: string
}

Job {                                // normalized, platform-agnostic
  platform: 'freelancer' | 'upwork'
  externalId: string
  url: string
  title: string
  description: string
  budget: { min?: number; max?: number; currency: string; type: 'fixed' | 'hourly' } | null
  skills: string[]
  postedAt: string
  language?: string
  client?: { country?: string; rating?: number; reviews?: number; paymentVerified?: boolean }
}

ScoreResult {                        // what the LLM returns
  score: number                      // 0–100
  reasoning: string                  // 1–3 sentences, shown in Telegram and UI
  estimatedHours: number
  risks: string[]                    // 0–4 short items
}

Match {
  job: Job
  status: 'filtered' | 'scored' | 'notified'
  filterReason?: string              // e.g. 'budget_below_min', 'stop_word:wordpress', 'language', 'stale'
  score?: ScoreResult
  verdict?: 'strong' | 'maybe' | 'no' // derived in code: ≥80 strong, 50–79 maybe, <50 no
  feedback?: 'up' | 'down'
  telegramMessageId?: number
  createdAt: string; scoredAt?: string; notifiedAt?: string; feedbackAt?: string
  ttl: number
}

Run {
  startedAt: string; finishedAt?: string
  trigger: 'schedule' | 'manual'
  perPlatform: Record<string, { fetched: number; new: number; filtered: number; scored: number; notified: number; error?: string }>
  usage: { inputTokens: number; outputTokens: number }
  errors: string[]
  ttl: number
}
```

## 6. Poller pipeline

Trigger: EventBridge Scheduler `rate(15 minutes)` with payload `{ "trigger": "schedule" }`, or async invoke from the API with `{ "trigger": "manual", "userId": "<sub>" }`.

```
handler(event):
  users = event.userId ? [event.userId] : store.listActiveUsers()
  for user of users:                       // sequential; one user's failure is logged, loop continues
    try runForUser(user, event.trigger)
    catch e -> log; write RUN with error

runForUser(userId, trigger):
  run = store.startRun(userId, trigger)
  profile, settings = store.getProfile(userId), store.getSettings(userId)
  if !settings.telegram.chatId or !settings.telegram.tokenSet: record 'telegram_not_configured'; finish run; return

  // 1. retry unsent from previous runs
  for m in store.listMatches(userId, status='scored') where m.score.score >= settings.notifyThreshold:
    notify(m)

  // 2. per platform
  for adapter of enabledAdapters(settings):
    jobs = adapter.fetchRecent({ query, since: now - maxJobAgeHours })
    known = store.batchGetMatchKeys(userId, jobs)             // dedup
    fresh = jobs.filter(j => !known.has(j))
    for job of fresh:
      reason = preFilter(job, profile, settings)
      if reason: store.putMatch(userId, job, { status: 'filtered', filterReason: reason }); continue
      result = scorer.score(job, profile, settings.model)     // Bedrock
      store.putMatch(userId, job, { status: 'scored', score: result, verdict })
      run.usage += result.usage
      if result.score >= settings.notifyThreshold: notify(match)
    record perPlatform counts

  store.finishRun(run)

notify(match):
  msgId = telegram.send(botToken, chatId, format(match))
  store.updateMatch(userId, match, { status: 'notified', telegramMessageId: msgId, notifiedAt })
```

Lambda config: 512 MB, 5 min timeout, `reserved_concurrent_executions = 1` (prevents overlapping scheduled runs).

## 7. Job source adapters

```ts
interface JobSource {
  readonly platform: Job['platform']
  fetchRecent(params: { query: string; since: Date; token: string }): Promise<Job[]>
  verifyToken(token: string): Promise<{ ok: true; username: string } | { ok: false; error: string }>
}
```

### Freelancer.com (v1)

- Base URL `https://www.freelancer.com/api`. Auth header `freelancer-oauth-v1: <token>`.
- Search: `GET /projects/0.1/projects/active/` with `query`, `limit`, `compact=true`, `job_details=true`, `user_details=true`, `full_description=true`, sorted by newest. Exact parameter names and response shape are confirmed against the live API during implementation and captured as JSON fixtures in `packages/core/adapters/freelancer/__fixtures__/`.
- Verify: `GET /users/0.1/self/` → username.
- Maps `budget.minimum/maximum`, `currency.code`, `type` (`fixed`/`hourly`), `jobs[].name` → skills, `submitdate` → postedAt, `language`, employer stats → client.
- Respects `Retry-After` on 429; any non-2xx aborts this adapter for the current run with the error recorded in RUN.

### Upwork (stub)

`fetchRecent` returns `[]` and `verifyToken` returns `{ ok: false, error: 'not_implemented' }`. Settings UI shows it disabled with a link to Upwork's API access application.

## 8. Pre-filter (deterministic, no LLM)

Evaluated in order; the first hit wins and becomes `filterReason`:

1. `stale` — `postedAt` older than `settings.maxJobAgeHours`.
2. `stop_word:<w>` — any `profile.stopWords` entry found case-insensitively in title or description.
3. `language` — `job.language` is set and not in `profile.languages`.
4. `budget_below_min` — fixed-price job with `budget.max < profile.budget.min`.
5. `budget_above_max` — fixed-price job with `budget.min > profile.budget.max`.

Hourly jobs and jobs with `budget = null` skip the budget rules; the LLM judges them.

## 9. LLM scoring

- Client: `AnthropicBedrockMantle` from `@anthropic-ai/bedrock-sdk`, region `us-east-1`, IAM auth via the Lambda role.
- Model: `settings.model`, default `anthropic.claude-haiku-4-5`. The exact Bedrock model id string is confirmed against `aws bedrock list-foundation-models` during implementation; the default is stored in one constant.
- No extended thinking (classification task). `max_tokens: 1024`.
- **System prompt** (stable across jobs for the same user, first content block marked with `cache_control: { type: 'ephemeral' }`; caching may not engage below the model's minimum cacheable prefix — harmless):
  - Role: you evaluate freelance job posts for a specific developer looking for small, well-scoped evening side gigs.
  - The developer's profile: skills with levels, budget range, max hours, languages, free text.
  - Scoring rubric: strong match = closed scope, clear deliverable, fits within `maxHours`, matches skills at `solid`/`expert` level or is straightforwardly solvable with an AI coding assistant; penalize long-term engagements, vague scope, "we need a team", unrealistic budget-to-effort ratio, suspicious clients.
- **User message**: the normalized job as a compact labelled block (title, budget, skills, client stats, posted, description).
- **Output**: forced tool use — one tool `score_job` with `strict: true` and an input schema generated from `ScoreResult` zod schema; `tool_choice: { type: 'tool', name: 'score_job' }`. Tool input is parsed with `JSON.parse` semantics via the SDK and validated with zod; validation failure counts as a scoring error for that job (job stays unscored and is retried next run).
- Token usage from `response.usage` is accumulated into the RUN item.

## 10. Telegram

### 10.1 Per-user bot

Each user creates their own bot via @BotFather and pastes the token in Settings. On save the API Lambda:

1. Calls `getMe` — invalid token → 400 with Telegram's error.
2. Generates `webhookSecret` (32 random bytes, hex).
3. Calls `setWebhook` with `url = <API base>/telegram/webhook/<sub>`, `secret_token = webhookSecret`, `allowed_updates = ['message', 'callback_query', 'my_chat_member', 'channel_post']`.
4. Stores the token in SSM `/gighunter/users/<sub>/telegram/bot-token` and updates SETTINGS (`tokenSet`, `tokenHint`, `botUsername`, `webhookSecret`).

Deleting the token calls `deleteWebhook`, removes the SSM parameter, and clears the Telegram fields in SETTINGS.

### 10.2 Chat detection (webhook)

The webhook Lambda validates `X-Telegram-Bot-Api-Secret-Token` against the user's `webhookSecret` (constant-time compare); mismatch → 403. Then:

- `message` with text `/start` in a private chat → `chatId = message.chat.id`, `chatTitle = "DM with @<username>"`; reply "Connected. Notifications will arrive here."
- `my_chat_member` where the bot's new status is `administrator` in a channel/supergroup → `chatId`, `chatTitle = chat.title`.
- `channel_post` → sets `chatId`/`chatTitle` only if not yet set.
- `my_chat_member` where the bot's new status is `left` or `kicked` in the currently configured chat → clears `chatId`/`chatTitle` (the poller then records `telegram_not_configured` until a new chat is detected).
- Latest explicit event wins; the Settings page shows the detected chat and allows manual override.

### 10.3 Notification format

HTML parse mode:

```
🎯 <b>82/100</b> · Fix Stripe webhook retries in Next.js
💰 $150–300 fixed · ⏱ ~3h · Freelancer
<b>Why:</b> exact Next.js + Stripe match, closed scope, tests included.
<b>Risks:</b> new client, 0 reviews.
🔗 <a href="…">Open job</a>
[ 👍 Useful ]  [ 👎 Not for me ]
```

Inline keyboard `callback_data = fb:<platform>:<externalId>:up|down` (≤ 64 bytes).

### 10.4 Feedback callback

`callback_query` → update MATCH `feedback`/`feedbackAt` → `answerCallbackQuery` → `editMessageReplyMarkup` replacing the keyboard with a single button reflecting the choice (`callback_data = noop`). Feedback is stored only in v1; it is not fed back into the prompt.

## 11. Web UI (`apps/web`)

Routes:

- `/login` — button → Cognito Hosted UI (Google). Uses `react-oidc-context` (authorization code + PKCE). Tokens in memory + session storage.
- `/profile` — form bound to `Profile` zod schema: display name, skills list (name + level), budget min/max, max hours, languages, stop words, free text.
- `/settings` — four blocks, each: short step-by-step instructions (static markdown in the app) → inputs → action button → status line. Secrets are write-only; after save the UI shows `✓ set ···<hint>` and a Remove button.
  1. **Telegram** — BotFather steps; token input; status: bot `@name` ✓ · webhook ✓ · chat: *title* ✓; **Send test message** button; manual chat id override.
  2. **Freelancer.com** — developer portal steps; token input; status: connected as *username*; `enabled` toggle; search query.
  3. **Upwork** — disabled; link to API access application.
  4. **Matching** — notify threshold slider (default 70), max job age, model dropdown, `active` toggle.
- `/jobs` — feed of MATCH items (GSI2), status filter chips (`notified` / `scored` / `filtered`), score, verdict badge, reasoning, risks, feedback marker, link. Below: last 10 RUNs with per-platform counts, token usage, errors.
- Header: user email, **Run now** button (POST `/runs`, shows toast, feed refetches after 30 s), sign out.

Stack: TanStack Router (file-based), TanStack Query, TanStack Form, Tailwind. No component library.

## 12. API (`apps/lambdas/api`, Hono)

All routes require a valid Cognito JWT (API Gateway JWT authorizer). `sub` is taken from the JWT claims only; request bodies never carry a user id.

| Method | Path | Behavior |
|---|---|---|
| GET | `/me` | `{ sub, email }` |
| GET / PUT | `/profile` | Profile (PUT validates with zod, 400 on error) |
| GET | `/settings` | Settings with secret fields masked |
| PATCH | `/settings` | `active`, `notifyThreshold`, `maxJobAgeHours`, `model`, `platforms.freelancer.{enabled,query}`, `telegram.chatId` |
| PUT | `/settings/telegram/token` | see §10.1 |
| DELETE | `/settings/telegram/token` | see §10.1 |
| POST | `/settings/telegram/test` | sends "GigHunter test message" to `chatId` |
| PUT | `/settings/freelancer/token` | `verifyToken` → SSM `/gighunter/users/<sub>/freelancer/token`, update SETTINGS |
| DELETE | `/settings/freelancer/token` | remove parameter, clear fields |
| GET | `/matches?status=&cursor=` | page of MATCH items, newest first |
| GET | `/runs?limit=` | recent RUN items |
| POST | `/runs` | async-invoke poller with `{ trigger: 'manual', userId }` → 202 |

Public (no authorizer): `POST /telegram/webhook/{userId}` → tg-webhook Lambda.

Errors: JSON `{ error: string }` with 400/403/404/500. CORS restricted to the CloudFront origin.

## 13. Auth

- Cognito User Pool; Google as identity provider (client id/secret supplied to Terraform via `TF_VAR_google_client_secret`, never committed). Cognito-prefixed Hosted UI domain. One public app client: authorization code + PKCE, callback/logout URLs = CloudFront origin (+ `http://localhost:5173` for dev).
- **Pre-sign-up Lambda trigger**: reads `/gighunter/auth/allowed-emails` (comma-separated) from SSM; if the incoming email is not listed, throws → Cognito rejects sign-up. Listed emails are auto-confirmed. This is the v1 gate against arbitrary Google accounts consuming Bedrock budget.
- API Gateway JWT authorizer validates the ID token; the API Lambda reads `sub` and `email` from `requestContext.authorizer.jwt.claims`.

## 14. Secrets and configuration

SSM Parameter Store, SecureString, default KMS key:

| Parameter | Owner | Written by |
|---|---|---|
| `/gighunter/auth/allowed-emails` | app | operator (`aws ssm put-parameter`) |
| `/gighunter/users/<sub>/telegram/bot-token` | user | API Lambda |
| `/gighunter/users/<sub>/freelancer/token` | user | API Lambda |

IAM: API Lambda may `PutParameter`/`GetParameter`/`DeleteParameter` under `/gighunter/users/*`; poller and tg-webhook may `GetParameter` under `/gighunter/users/*`; pre-signup may `GetParameter` on `/gighunter/auth/*`. Nothing else touches SSM.

Non-secret config is passed as Lambda environment variables (table name, API base URL, default model, region).

## 15. Infrastructure (Terraform)

`infra/bootstrap` (local state, applied once): S3 bucket for Terraform state (versioning on, public access blocked, SSE-S3).

`infra/main` (backend `s3`, `use_lockfile = true`):

- DynamoDB table `gighunter` (on-demand, PITR on, TTL attribute `ttl`, GSI1, GSI2).
- Four Lambda functions (`nodejs22.x`, `arm64`), each from `archive_file` over `apps/lambdas/dist/<name>/`, `source_code_hash` set, CloudWatch log groups with 14-day retention.
- EventBridge Scheduler schedule `rate(15 minutes)` → poller.
- API Gateway HTTP API: JWT authorizer (Cognito), `$default` route → api Lambda, `POST /telegram/webhook/{userId}` → tg-webhook Lambda (no auth), CORS.
- Cognito User Pool, Google IdP, app client, Hosted UI domain, pre-sign-up trigger wiring.
- S3 bucket (private) + CloudFront distribution with OAC, default root `index.html`, 403/404 → `/index.html` (SPA fallback).
- SNS topic + email subscription; CloudWatch alarm on poller `Errors ≥ 1` over 1 hour.
- IAM roles per Lambda with least privilege: Bedrock `InvokeModel` on the Anthropic model ARNs in `us-east-1` only; DynamoDB actions on the one table and its indexes; SSM per §14; api Lambda may `lambda:InvokeFunction` on the poller.

Variables: `project` (default `gighunter`), `aws_profile` (default `yevhenii`), `region` (default `us-east-1`), `google_client_id`, `google_client_secret` (sensitive), `alarm_email`. Single environment in v1.

Frontend deploy is a script (`pnpm deploy:web`): `vite build` → `aws s3 sync --delete` → CloudFront invalidation. Terraform does not manage bucket objects.

## 16. Error handling

| Failure | Behavior |
|---|---|
| Platform API error / 429 | Adapter aborts for this run; error recorded in RUN `perPlatform.<p>.error`; other adapters and users continue. Retried naturally next schedule. |
| Bedrock throttling / 5xx | SDK retries (max 3, exponential backoff). Persistent failure → job left unscored (no MATCH written), retried next run; error counted in RUN. |
| Invalid LLM output (zod fails) | Same as above; logged with the raw tool input for debugging. |
| Telegram send error | MATCH stays `scored`; picked up by the "retry unsent" step next run. |
| Telegram not configured | Run records `telegram_not_configured` and skips fetching (no point paying for scoring). |
| Webhook secret mismatch | 403, no processing, logged. |
| Overlapping scheduled runs | Prevented by `reserved_concurrent_executions = 1`. |
| Poller crash | CloudWatch alarm → SNS email. |

All Lambdas log structured JSON (`{ level, userId?, event, ... }`) via a tiny logger in `core`.

## 17. Out of scope (v1)

Upwork adapter implementation (interface and settings stub only; API key application should be submitted now since approval takes weeks) · Djinni/RSS sources · proposal/cover-letter drafts · résumé import from PDF/LinkedIn · feeding feedback into the prompt · invites/admin UI · per-user LLM quotas · Telegram deep-link account linking · custom domain · dev/prod environment split · SQS fan-out.

## 18. Testing

- **Unit (vitest, `packages/core`)**
  - `filter`: table-driven cases for every `filterReason` and pass-through.
  - `scorer`: mocked Bedrock client; asserts prompt assembly, forced tool call, zod validation, usage accounting, error mapping.
  - `adapters/freelancer`: HTTP mocked with recorded fixtures; asserts normalization and 429/5xx handling.
  - `notifier`: message formatter snapshot; callback_data length ≤ 64.
  - `store`: key construction and GSI attribute derivation (pure functions), plus DynamoDB Local-free tests via a mocked DocumentClient.
  - `pipeline/runForUser`: all dependencies injected; asserts ordering (retry-unsent first), dedup, status transitions, RUN accounting.
- **Handlers (`apps/lambdas`)**: tg-webhook secret check and update routing; api route validation and user scoping; pre-signup allowlist.
- **Contract script** `pnpm freelancer:probe` — hits the real API with a local token, prints the normalized jobs, refreshes fixtures on demand.
- **Local run** `pnpm poller:local -- --user <sub> [--dry-run]` — runs `runForUser` against the deployed DynamoDB/Bedrock from the laptop; `--dry-run` skips Telegram sends and DB writes.
- **Web**: vitest + Testing Library for the Profile and Settings forms (validation, masked secrets, status rendering). No e2e in v1.

## 19. Cost estimate (single active user)

| Component | Idle | Active |
|---|---|---|
| Lambda (≈2,900 poller runs/month + API) | free tier | free tier |
| DynamoDB on-demand | ~$0 | cents |
| EventBridge Scheduler | free | free |
| API Gateway HTTP API | ~$0 | <$0.10 |
| S3 + CloudFront | ~$0 | cents |
| Cognito (Google federation) | free tier | free tier |
| SSM Parameter Store (standard) | free | free |
| CloudWatch logs (14-day retention) | ~$0 | <$0.50 |
| Bedrock, Haiku 4.5, ~30 scored jobs/day | $0 | ~$1–3 |

Expected total: **≈ $0–1/month idle, ≈ $2–5/month in active use.**

## 20. Implementation-time verifications

These are defaults that are confirmed (not decided) during implementation; each has a stated fallback:

- Freelancer API query parameters and response fields (§7) — verified via `freelancer:probe`; fixtures updated accordingly.
- Bedrock model id for Haiku 4.5 (§9) — verified via `aws bedrock list-foundation-models --by-provider anthropic`; the constant is updated.
- Lambda runtime: `nodejs22.x` is the default; if `nodejs24.x` is available in `us-east-1` at implementation time, use it.
- Forced tool use with `strict: true` on Bedrock for Haiku 4.5 — if unsupported, drop `strict` and rely on zod validation.
