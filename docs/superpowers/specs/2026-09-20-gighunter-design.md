# GigHunter — Design Spec

**Date:** 2026-09-20
**Status:** Approved for implementation planning

## 1. Overview

GigHunter is a personal-first, multi-user-ready web app that watches freelance platforms for small "evening gigs" that match a developer's profile and pushes the good ones to that developer's Telegram bot with an AI-generated score and explanation.

A user configures a profile (structured skills + free text), connects their own platform API tokens and their own Telegram bot on a Settings page, and the system polls the platforms every 15 minutes, filters, scores each new job with Claude on Bedrock, and notifies. Every found job also has its own chat with Claude, pre-loaded with the app's purpose, the user's profile, the job and the score, so the user can draft a proposal or cover letter, estimate effort, or ask questions without re-explaining context.

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
| LLM | **Amazon Bedrock**, Claude **Haiku 4.5** by default; scoring model and chat model are separate per-user settings. |
| Per-job chat | Each MATCH has one conversation stored as a single DynamoDB item; non-streaming request/response through the API Lambda; quick-action prompts (proposal, estimate, questions). |
| Prompts | Scoring prompt, chat prompt and quick actions are per-user templates editable in the UI, with shipped defaults and `{{placeholders}}` for context injection. Output schemas stay code-defined. |
| Pipeline orchestration | Single poller Lambda iterating over active users (monolithic pipeline). SQS fan-out deferred until >10 users or long runs. |
| Poll cadence | EventBridge Scheduler, every 15 minutes. |
| Frontend | TanStack Router + Vite SPA, static on S3 + CloudFront at **https://gighunter.onlytools.click**. TanStack Query, TanStack Form, Tailwind. Public landing page at `/`, app behind login. |
| Domain | `gighunter.onlytools.click` — Route53 zone `onlytools.click` already exists in the account (`Z0516204CSXC7Z2EC0FW`); ACM certificate in `us-east-1` with DNS validation; CloudFront alias. |
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
│   │   └── src/routes/         # file-based routes: login, profile, settings, jobs, jobs/$platform/$id
│   └── lambdas/                # thin handlers only; all logic lives in packages/core
│       ├── poller/
│       ├── api/
│       ├── tg-webhook/
│       └── pre-signup/
├── packages/
│   └── core/                   # domain logic; no HTTP/Lambda types in public interfaces
│       ├── schema/             # zod: Profile, Settings, Prompts, Job, Match, Run, Chat, ScoreResult
│       ├── adapters/           # JobSource interface, freelancer/, upwork/ (stub)
│       ├── filter/             # deterministic pre-filter
│       ├── prompts/            # default templates, placeholder rendering, validation
│       ├── scorer/             # Bedrock call for scoring + response validation
│       ├── chat/               # per-job chat turn runner
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
| `USER#<sub>` | `PROMPTS` | Prompt template overrides (absent field = shipped default) |
| `USER#<sub>` | `MATCH#<platform>#<externalId>` | Match: denormalized job + score + status + feedback |
| `USER#<sub>` | `RUN#<startedAtIso>` | Run: per-run stats and token usage |
| `USER#<sub>` | `CHAT#<platform>#<externalId>` | Chat: full message history for one match |

Indexes:

- **GSI1** `gsi1pk`/`gsi1sk`: SETTINGS items carry `gsi1pk = ACTIVE_USER`, `gsi1sk = <sub>` when `active = true`. The poller queries this to enumerate users.
- **GSI2** `gsi2pk`/`gsi2sk`: MATCH items carry `gsi2pk = USER#<sub>#<status>`, `gsi2sk = <postedAt>`. One query per feed tab (newest first) and for the "retry unsent" step (`USER#<sub>#pending`).

MATCH items have a `ttl` attribute = `createdAt + 60 days`. RUN items: `ttl = startedAt + 30 days`. CHAT items: `ttl = createdAt + 60 days`, matching their MATCH.

A chat is one item (not one item per message) because the whole history is sent to the model on every turn anyway and there is no concurrent writer per user. Guard: a chat is capped at 200 messages or 300 KB serialized; beyond that the API returns 409 and the UI offers **Reset chat**.

Jobs are denormalized into MATCH items rather than stored once in a shared `JOB#…` item. A shared job cache can be added later without migrating existing items.

### 5.1 Schemas (zod, in `packages/core/schema`)

```ts
Profile {
  displayName: string
  skills: { name: string; level: 'basic' | 'solid' | 'expert' }[]
  budget: { min: number; max: number; currency: 'USD' }   // acceptable fixed-price range per gig
  maxHours: number                                        // max effort per gig
  languages: string[]                                     // ISO 639-1, e.g. ['en', 'uk']
  stopWords: string[]                                     // whole-word, case-insensitive, matched in title+description
  freeText: string                                        // "about me / what I'm looking for", ≤ 4000 chars
  filters: {                                              // deterministic pre-AI filters; all optional with permissive defaults
    mustHaveAny: string[]                                 // at least one must appear (whole-word) in title+description; empty = off
    jobTypes: ('fixed' | 'hourly')[]                      // default both
    minHourlyRate?: number                                // hourly jobs whose max rate is below this are dropped
    requirePaymentVerified: boolean                       // default false; unknown client counts as unverified
    minClientRating?: number                              // 0–5
    minClientReviews?: number
  }
  updatedAt: string
}

Settings {
  active: boolean                    // OFF switch: inactive users are never fetched or scored
  pollIntervalMinutes: number        // 15–1440, default 15; the 15-min scheduler runs a user only when this much time has passed since lastPolledAt
  lastPolledAt?: string              // stamped by the poller after every run (schedule or manual)
  notifyThreshold: number            // 0–100, default 70
  maxJobAgeHours: number             // ignore jobs older than this, default 24
  model: string                      // scoring model, Bedrock id, default 'global.anthropic.claude-haiku-4-5-20251001-v1:0' (see §9)
  chatModel: string                  // per-job chat model, default same as `model`; user may pick a stronger one
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

Prompts {                            // every field optional; missing = use default from packages/core/prompts/defaults.ts
  scoring?: string                   // system prompt template for §9.1, ≤ 8000 chars
  chat?: string                      // system prompt template for §9.2, ≤ 8000 chars
  quickActions?: { label: string; text: string }[]   // 1–8 entries, label ≤ 40 chars, text ≤ 2000 chars
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
  status: 'filtered' | 'scored' | 'pending' | 'notified'
                                     // filtered: pre-filter rejected · scored: LLM score below threshold
                                     // pending: score ≥ threshold, Telegram delivery not yet confirmed · notified: delivered
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

Chat {
  messages: { role: 'user' | 'assistant'; content: string; at: string }[]   // plain text only in v1
  usage: { inputTokens: number; outputTokens: number }                       // cumulative for this chat
  createdAt: string; updatedAt: string
  ttl: number
}
```

## 6. Poller pipeline

Trigger: EventBridge Scheduler `rate(15 minutes)` with payload `{ "trigger": "schedule" }`, or async invoke from the API with `{ "trigger": "manual", "userId": "<sub>" }`.

```
handler(event):
  users = event.userId ? [event.userId] : store.listActiveUsers()
  for user of users:                       // sequential; one user's failure is logged, loop continues
    if event.trigger == 'schedule' and !isDue(settings(user)): skip   // active && lastPolledAt + pollIntervalMinutes <= now
    try runForUser(user, event.trigger)
    catch e -> log; write RUN with error

runForUser(userId, trigger):
  run = store.startRun(userId, trigger)
  profile, settings = store.getProfile(userId), store.getSettings(userId)
  if !settings.telegram.chatId or !settings.telegram.tokenSet: record 'telegram_not_configured'; finish run; return

  // 1. retry unsent from previous runs
  for m in store.listMatches(userId, status='pending'):
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
      status = result.score >= settings.notifyThreshold ? 'pending' : 'scored'
      store.putMatch(userId, job, { status, score: result, verdict })
      run.usage += result.usage
      if status == 'pending': notify(match)
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

API key applied for on 2026-09-21 with OAuth 2.0 authorization-code flow and callback URL `https://gighunter.onlytools.click/upwork/callback`. v2 design: the SPA route `/upwork/callback` receives `?code=` while the user is signed in and calls `POST /settings/upwork/connect { code }`; the API exchanges the code using the client id/secret (SSM `/gighunter/upwork/client-id` and `/client-secret`, app-level) and stores the per-user refresh/access tokens under `/gighunter/users/<sub>/upwork/token`; `platforms.upwork` gains `enabled`/`query`/`connectedAs` like Freelancer.

## 8. Pre-filter (deterministic, no LLM)

Evaluated in order; the first hit wins and becomes `filterReason`:

1. `stale` — `postedAt` older than `settings.maxJobAgeHours`.
2. `stop_word:<w>` — any `profile.stopWords` entry found as a whole word, case-insensitively, in title or description.
3. `language` — `job.language` is set and not in `profile.languages`.
4. `job_type:<t>` — `budget.type` not in `filters.jobTypes`.
5. `budget_below_min` — fixed-price job with `budget.max < profile.budget.min`.
6. `budget_above_max` — fixed-price job with `budget.min > profile.budget.max`.
7. `hourly_rate_below_min` — hourly job with `budget.max < filters.minHourlyRate`.
8. `keyword_missing` — `filters.mustHaveAny` is non-empty and none of its entries appears (whole word) in title or description.
9. `payment_not_verified` — `filters.requirePaymentVerified` and the client is not known to be verified.
10. `client_rating_below_min` / `client_reviews_below_min` — client stats (missing = 0) below the configured minimums.

Jobs with `budget = null` skip the budget and rate rules; the LLM judges them. The per-run scoring cap (`MAX_SCORED_PER_RUN = 20` per platform) is a cost guard, not a filter: jobs beyond it are left unwritten and picked up next run, and the run records `score_cap:<platform>:<n>_skipped`.

## 9. LLM usage

Both uses share one Bedrock client factory in `packages/core` (`createBedrockClient(modelId)`), using `@anthropic-ai/bedrock-sdk` with IAM auth from the Lambda role and `AWS_REGION`. Bedrock serves Claude models on two stacks, so the factory picks the client by model id:

- ARN-versioned ids (contain `-v1:0`, e.g. Haiku 4.5, Sonnet 4.5, Opus 4.6 and earlier) → legacy `AnthropicBedrock` client (InvokeModel path). Top-level automatic caching is rejected there; explicit `cache_control` blocks work.
- Everything else (Opus 4.7+, Opus 5, Sonnet 5, Fable) → `AnthropicBedrockMantle` (Messages-API endpoint).

Model ids use the `global.` inference-profile prefix (dynamic routing, no regional pricing premium). Default: `global.anthropic.claude-haiku-4-5-20251001-v1:0`.

### 9.0 Prompt templates

Both system prompts are per-user templates (`PROMPTS` item, §5.1) rendered by `packages/core/prompts`:

- Placeholders: `{{app_context}}` (fixed paragraph describing GigHunter and the "evening gig" goal), `{{profile}}` (rendered Profile), `{{job}}` (rendered Job), `{{score}}` (rendered ScoreResult/verdict, or the filter reason; chat template only). Rendering is plain string substitution; no logic, no loops.
- Safety rule: if a template omits `{{profile}}` or `{{job}}` (or `{{score}}` for chat), the missing block is appended at the end under a heading, so context is never lost by an editing mistake.
- Defaults live in `packages/core/prompts/defaults.ts` and are the source of truth; the UI shows them read-only when no override is set and offers **Reset to default** per field.
- Validation (zod): length limits per §5.1, templates must not be blank, quick-action labels unique.
- The output contract is **not** editable: scoring always uses the fixed `score_job` tool schema, and the chat always returns free text. Users tune judgement and style, not the data shape.
- Templates are rendered on every use (each scoring call, each chat turn), so an edit applies immediately, including to existing chats. Changing a template invalidates that user's prompt cache prefix — expected and harmless.

### 9.1 Scoring (poller)

- Client: shared factory above.
- Model: `settings.model`, default `global.anthropic.claude-haiku-4-5-20251001-v1:0`, stored in one constant (`DEFAULT_MODEL`).
- No extended thinking (classification task). `max_tokens: 1024`.
- **System prompt** = rendered `prompts.scoring` template (§9.0), one content block marked `cache_control: { type: 'ephemeral' }` (caching may not engage below the model's minimum cacheable prefix — harmless). The shipped default contains:
  - Role: you evaluate freelance job posts for a specific developer looking for small, well-scoped evening side gigs (`{{app_context}}`).
  - `{{profile}}` — skills with levels, budget range, max hours, languages, free text.
  - Scoring rubric: strong match = closed scope, clear deliverable, fits within max hours, matches skills at `solid`/`expert` level or is straightforwardly solvable with an AI coding assistant; penalize long-term engagements, vague scope, "we need a team", unrealistic budget-to-effort ratio, suspicious clients.
- **User message**: `{{job}}` rendered as a compact labelled block (title, budget, skills, client stats, posted, description). The job goes in the user turn, not the system prompt, so the system prefix stays cacheable across jobs.
- **Output**: structured outputs — `client.messages.parse({ output_config: { format: zodOutputFormat(ScoreResultSchema) } })`; `response.parsed_output` is the validated `ScoreResult` (null → scoring error for that job: it stays unscored and is retried next run). Fallback if Bedrock rejects `output_config` for the selected model: one tool `score_job` with `strict: true`, `tool_choice: { type: 'tool', name: 'score_job' }`, input validated with zod.
- Token usage from `response.usage` is accumulated into the RUN item.

### 9.2 Per-job chat (api Lambda)

- Model: `settings.chatModel`. Adaptive thinking is left off for Haiku (it takes `budget_tokens`, not needed here); if the user selects an Opus/Sonnet 4.6+ model, the chat module passes `thinking: { type: 'adaptive' }`. `max_tokens: 4096`.
- **System prompt** = rendered `prompts.chat` template (§9.0), one block marked `cache_control: { type: 'ephemeral' }` (stable for the life of the chat unless the user edits the template). The shipped default contains:
  - `{{app_context}}` — what GigHunter is and what the user is doing: looking for small, well-scoped side gigs to do in the evenings, often with an AI coding assistant.
  - `{{profile}}`.
  - `{{job}}` — title, url, budget, skills, client stats, posted, full description.
  - `{{score}}` — score, verdict, reasoning, estimated hours and risks (or the filter reason if the job was filtered).
  - Instructions: write in the user's voice, be concrete, keep proposals short (the platforms favour brevity), never invent experience the profile does not support, ask for missing facts instead of guessing.
- **Turn**: `messages = chat.messages + [{ role: 'user', content }]` → one non-streaming `messages.create` → append both the user message and the assistant text to the CHAT item → return the assistant text. If the model stops on `max_tokens`, the reply is returned as-is with a `truncated: true` flag the UI shows.
- **Quick actions** are ordinary user messages with preset text, sent by UI buttons. They come from `prompts.quickActions`; the shipped default is *Draft proposal*, *Estimate effort*, *Questions for the client*, *Summarize the job*. They are stored in the chat like any other message.
- Non-streaming is deliberate: API Gateway HTTP API cannot stream Lambda responses; Haiku answers a proposal-sized reply in a few seconds. Streaming via a Lambda Function URL is a v2 option.
- Usage is accumulated into `chat.usage`.

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
🔗 <a href="…">Open job</a> · 💬 <a href="<APP_URL>/jobs/freelancer/123">Chat in GigHunter</a>
[ 👍 Useful ]  [ 👎 Not for me ]
```

`APP_URL` (`https://gighunter.onlytools.click`) is a poller environment variable.

Inline keyboard `callback_data = fb:<platform>:<externalId>:up|down` (≤ 64 bytes).

### 10.4 Feedback callback

`callback_query` → update MATCH `feedback`/`feedbackAt` → `answerCallbackQuery` → `editMessageReplyMarkup` replacing the keyboard with a single button reflecting the choice (`callback_data = noop`). Feedback is stored only in v1; it is not fed back into the prompt.

## 11. Web UI (`apps/web`)

Routes:

- `/` — **public landing page**: one screen, no data fetching. Product name and one-line pitch ("Your evening-gig radar: AI-scored freelance jobs, delivered to your Telegram"), three short feature blurbs (profile-based matching · per-job chat that drafts proposals · your own bot, your own keys), a **Sign in with Google** button that starts the Cognito flow, and a footer with the GitHub link. If the visitor is already signed in, the button reads **Open app** and links to `/jobs`. Static content lives in the route file; no CMS, no analytics in v1.
- `/login` — kept as the OIDC callback/redirect handler only (the Sign-in button on `/` starts the flow). Uses `react-oidc-context` (authorization code + PKCE). Tokens in memory + session storage. After login, redirects to `/jobs` (or the originally requested route).
- `/profile` — form bound to `Profile` zod schema: display name, skills list (name + level), budget min/max, max hours, languages, stop words, free text.
- `/settings` — four blocks, each: short step-by-step instructions (static markdown in the app) → inputs → action button → status line. Secrets are write-only; after save the UI shows `✓ set ···<hint>` and a Remove button.
  1. **Telegram** — BotFather steps; token input; status: bot `@name` ✓ · webhook ✓ · chat: *title* ✓; **Send test message** button; manual chat id override.
  2. **Freelancer.com** — developer portal steps; token input; status: connected as *username*; `enabled` toggle; search query.
  3. **Upwork** — disabled; link to API access application.
  4. **Matching & AI** — **Job search ON/OFF** (`active`) and **poll every** 15 min / 30 min / 1 h / 2 h / 4 h / 12 h / 24 h (`pollIntervalMinutes`) shown first as the cost controls; notify threshold slider (default 70), max job age, scoring model dropdown, chat model dropdown.
  5. **Prompts** — two textareas (*Scoring prompt*, *Chat prompt*) pre-filled with the shipped default or the user's override; a hint listing the available `{{placeholders}}`; per-field **Reset to default**; **Preview** renders the template with the real profile and a bundled sample job and shows the exact text the model will receive. Below: **Quick actions** editor — rows of label + text, add/remove/reorder, max 8, **Reset to default**.
- `/jobs` — feed of MATCH items (GSI2), status filter chips (`notified` / `pending` / `scored` / `filtered`, default `notified`), score, verdict badge, reasoning, risks, feedback marker, link. Each row links to the job detail. Below: last 10 RUNs with per-platform counts, token usage, errors.
- `/jobs/$platform/$id` — job detail: full job (description, budget, skills, client stats, external link), our score/verdict/reasoning/risks or filter reason, feedback buttons (same effect as Telegram 👍👎). Right/below: **chat panel** — message list, input, quick-action buttons (*Draft proposal*, *Estimate effort*, *Questions for the client*, *Summarize the job*), copy button on assistant messages, **Reset chat**. Sending disables the input until the reply arrives (a few seconds).
- App routes (`/profile`, `/settings`, `/jobs`, `/jobs/$platform/$id`) sit under an authenticated layout route; an unauthenticated visitor is redirected to `/`.
- Header (app layout only): user email, **Run now** button (POST `/runs`, shows toast, feed refetches after 30 s), sign out. A manual run ignores `pollIntervalMinutes` and runs even when job search is OFF (`active = false`), so a paused user can still search on demand.

Stack: TanStack Router (file-based), TanStack Query, TanStack Form, Tailwind. No component library.

**Mobile-first is a hard requirement.** The main entry point is the "Chat in GigHunter" link tapped from Telegram on a phone, so every screen is designed at 360 px width first and enhanced for desktop:

- Single-column layouts; the Jobs feed and Runs list render as cards, never tables; no horizontal scrolling anywhere.
- The job detail page on a phone is the chat: job summary collapses into an expandable header, the message list fills the viewport, the input and quick-action chips stick to the bottom above the keyboard (`100dvh`, `env(safe-area-inset-bottom)`).
- Touch targets ≥ 44 px, 16 px base font (prevents iOS zoom on focus), forms with native inputs (`inputmode`, `enterkeyhint`).
- Bottom navigation bar (Jobs · Profile · Settings) on small screens, header nav on ≥ 768 px.
- Settings instruction blocks are collapsible so the token inputs are reachable without scrolling past four paragraphs.
- Installable as a PWA (manifest + icons, `display: standalone`) so it can live on the home screen; no offline mode in v1.
- Verified on real phone widths (360, 390, 430) before the web plan is considered done.

## 12. API (`apps/lambdas/api`, Hono)

All routes require a valid Cognito JWT (API Gateway JWT authorizer). `sub` is taken from the JWT claims only; request bodies never carry a user id.

| Method | Path | Behavior |
|---|---|---|
| GET | `/me` | `{ sub, email }` |
| GET / PUT | `/profile` | Profile (PUT validates with zod, 400 on error) |
| GET | `/settings` | Settings with secret fields masked |
| PATCH | `/settings` | `active`, `pollIntervalMinutes`, `notifyThreshold`, `maxJobAgeHours`, `model`, `chatModel`, `platforms.freelancer.{enabled,query}`, `telegram.chatId` |
| GET | `/prompts` | `{ defaults, overrides }` |
| PUT | `/prompts` | partial update of `scoring` / `chat` / `quickActions`; `null` resets a field to default; zod-validated |
| POST | `/prompts/preview` | `{ kind: 'scoring' \| 'chat', template }` → `{ rendered }` using the caller's profile and a bundled sample job/score |
| PUT | `/settings/telegram/token` | see §10.1 |
| DELETE | `/settings/telegram/token` | see §10.1 |
| POST | `/settings/telegram/test` | sends "GigHunter test message" to `chatId` |
| PUT | `/settings/freelancer/token` | `verifyToken` → SSM `/gighunter/users/<sub>/freelancer/token`, update SETTINGS |
| DELETE | `/settings/freelancer/token` | remove parameter, clear fields |
| GET | `/matches?status=&cursor=` | page of MATCH items, newest first |
| GET | `/matches/{platform}/{id}` | one MATCH plus its CHAT (empty if none) |
| POST | `/matches/{platform}/{id}/feedback` | `{ feedback: 'up' \| 'down' }` — same effect as the Telegram buttons |
| POST | `/matches/{platform}/{id}/chat` | `{ message }` → runs one turn (§9.2) → `{ reply, truncated, usage }`; 404 if the MATCH does not exist; 409 if the chat is at its cap |
| DELETE | `/matches/{platform}/{id}/chat` | deletes the CHAT item |
| GET | `/runs?limit=` | recent RUN items |
| POST | `/runs` | async-invoke poller with `{ trigger: 'manual', userId }` → 202 |

Public (no authorizer): `POST /telegram/webhook/{userId}` → tg-webhook Lambda.

Errors: JSON `{ error: string }` with 400/403/404/500. CORS restricted to `https://gighunter.onlytools.click` (+ `http://localhost:5173` for dev).

## 13. Auth

- Cognito User Pool; Google as identity provider (client id/secret supplied to Terraform via `TF_VAR_google_client_secret`, never committed). Cognito-prefixed Hosted UI domain. One public app client: authorization code + PKCE, callback URL `https://gighunter.onlytools.click/login`, logout URL `https://gighunter.onlytools.click/` (+ `http://localhost:5173/login` and `http://localhost:5173/` for dev). The Google OAuth app's authorized redirect URI is the Cognito domain's `/oauth2/idpresponse`.
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
- Four Lambda functions (`nodejs22.x`, `arm64`), each from `archive_file` over `apps/lambdas/dist/<name>/`, `source_code_hash` set, CloudWatch log groups with 14-day retention. The api Lambda gets a 29 s timeout (API Gateway's maximum) to accommodate chat turns.
- EventBridge Scheduler schedule `rate(15 minutes)` → poller.
- API Gateway HTTP API: JWT authorizer (Cognito), `$default` route → api Lambda, `OPTIONS /{proxy+}` without auth (required for automatic CORS preflight when `$default` has an authorizer), `POST /telegram/webhook/{userId}` → tg-webhook Lambda (no auth), CORS.
- Cognito User Pool, Google IdP, app client, Hosted UI domain, pre-sign-up trigger wiring.
- ACM certificate for `gighunter.onlytools.click` in `us-east-1`, DNS-validated through Route53 records Terraform creates in the existing `onlytools.click` zone (looked up by name with `data "aws_route53_zone"`, not managed).
- S3 bucket (private) + CloudFront distribution with OAC, alias `gighunter.onlytools.click`, the ACM certificate (TLS 1.2+, SNI), default root `index.html`, 403/404 → `/index.html` (SPA fallback). Route53 `A` and `AAAA` alias records pointing at the distribution.
- SNS topic + email subscription; CloudWatch alarm on poller `Errors ≥ 1` over 1 hour.
- IAM roles per Lambda with least privilege: `bedrock:InvokeModel` on `arn:aws:bedrock:*::foundation-model/anthropic.*` and `arn:aws:bedrock:*:<account>:inference-profile/*anthropic*` (poller and api Lambdas; `global.` inference profiles route across regions, so the foundation-model resource cannot be pinned to one region); DynamoDB actions on the one table and its indexes; SSM per §14; api Lambda may `lambda:InvokeFunction` on the poller.

Variables: `project` (default `gighunter`), `aws_profile` (default `yevhenii`), `region` (default `us-east-1`), `domain_name` (default `gighunter.onlytools.click`), `hosted_zone_name` (default `onlytools.click`), `google_client_id`, `google_client_secret` (sensitive), `alarm_email`. Single environment in v1.

Frontend deploy is a script (`pnpm deploy:web`): `vite build` → `aws s3 sync --delete` → CloudFront invalidation. Terraform does not manage bucket objects.

## 16. Error handling

| Failure | Behavior |
|---|---|
| Platform API error / 429 | Adapter aborts for this run; error recorded in RUN `perPlatform.<p>.error`; other adapters and users continue. Retried naturally next schedule. |
| Bedrock throttling / 5xx | SDK retries (max 3, exponential backoff). Persistent failure → job left unscored (no MATCH written), retried next run; error counted in RUN. |
| Invalid LLM output (zod fails) | Same as above; logged with the raw tool input for debugging. |
| Telegram send error | MATCH stays `pending`; picked up by the "retry unsent" step next run. |
| Telegram not configured | Run records `telegram_not_configured` and skips fetching (no point paying for scoring). |
| Webhook secret mismatch | 403, no processing, logged. |
| Chat turn: Bedrock error after SDK retries | 502 `{ error }`; nothing is appended to the CHAT item, so the user can resend. |
| Chat turn: API Gateway 29 s timeout | UI shows "took too long, try a shorter request or a faster model"; the CHAT item is unchanged (append happens only after a successful reply). |
| Overlapping scheduled runs | Prevented by `reserved_concurrent_executions = 1`. |
| Poller crash | CloudWatch alarm → SNS email. |

All Lambdas log structured JSON (`{ level, userId?, event, ... }`) via a tiny logger in `core`.

## 17. Out of scope (v1)

Upwork adapter implementation (interface and settings stub only; API key application should be submitted now since approval takes weeks) · Djinni/RSS sources · manual job import by pasting a URL · streaming chat replies · attachments/images in chat · résumé import from PDF/LinkedIn · feeding feedback into the prompt · invites/admin UI · per-user LLM quotas · Telegram deep-link account linking · dev/prod environment split · SQS fan-out · landing-page analytics or CMS.

## 18. Testing

- **Unit (vitest, `packages/core`)**
  - `filter`: table-driven cases for every `filterReason` and pass-through.
  - `scorer`: mocked Bedrock client; asserts prompt assembly, forced tool call, zod validation, usage accounting, error mapping.
  - `prompts`: placeholder substitution, missing-placeholder append rule, validation limits, defaults round-trip (rendering the default with a sample profile/job matches a snapshot).
  - `chat`: mocked Bedrock client; asserts the rendered template is used as the system prompt, history is passed in order, append-only-on-success, cap enforcement (409), `truncated` flag on `max_tokens`.
  - `adapters/freelancer`: HTTP mocked with recorded fixtures; asserts normalization and 429/5xx handling.
  - `notifier`: message formatter snapshot; callback_data length ≤ 64.
  - `store`: key construction and GSI attribute derivation (pure functions), plus DynamoDB Local-free tests via a mocked DocumentClient.
  - `pipeline/runForUser`: all dependencies injected; asserts ordering (retry-unsent first), dedup, status transitions, RUN accounting.
- **Handlers (`apps/lambdas`)**: tg-webhook secret check and update routing; api route validation and user scoping; pre-signup allowlist.
- **Contract script** `pnpm freelancer:probe` — hits the real API with a local token, prints the normalized jobs, refreshes fixtures on demand.
- **Local run** `pnpm poller:local -- --user <sub> [--dry-run]` — runs `runForUser` against the deployed DynamoDB/Bedrock from the laptop; `--dry-run` skips Telegram sends and DB writes.
- **Web**: vitest + Testing Library for the Profile and Settings forms (validation, masked secrets, status rendering), the Prompts block (reset/preview, quick-action editor limits) and the chat panel (quick actions send the configured text, input disabled while pending, reset confirmation). No e2e in v1.

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
| Bedrock, per-job chat (user-initiated, ~2–4K cached input + ~500 output per turn) | $0 | cents per chat on Haiku; ~$0.05–0.10 per chat on Sonnet 5 |

Expected total: **≈ $0–1/month idle, ≈ $2–5/month in active use.**

## 20. Implementation-time verifications

These are defaults that are confirmed (not decided) during implementation; each has a stated fallback:

- Freelancer API query parameters and response fields (§7) — verified via `freelancer:probe`; fixtures updated accordingly.
- Lambda runtime: `nodejs22.x` is the default; if `nodejs24.x` is available in `us-east-1` at implementation time, use it.
- Structured outputs (`output_config.format`) on Bedrock for Haiku 4.5 — confirmed with the first real scoring call; if rejected, the forced strict tool fallback in §9.1 is used.
