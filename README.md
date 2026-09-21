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

See [`infra/README.md`](infra/README.md). Short version, after the one-time bootstrap:

```bash
pnpm build && (cd infra/main && terraform apply)   # backend: Lambdas + everything else
pnpm deploy:web                                    # frontend: apps/web/dist (or the placeholder page)
```

Live endpoints: app `https://gighunter.onlytools.click`, API `https://wa70iakds2.execute-api.us-east-1.amazonaws.com`.

## Smoke test

```bash
API=$(cd infra/main && terraform output -raw api_url)
curl -s -o /dev/null -w '%{http_code}\n' "$API/me"                                          # 401 — JWT required
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/telegram/webhook/nobody" -d '{}'    # 403 — webhook secret required
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS "$API/me" -H 'Origin: https://gighunter.onlytools.click' -H 'Access-Control-Request-Method: GET'   # 204 — CORS preflight
```

End to end (needs a Telegram bot token from @BotFather and a Freelancer.com API token):

```bash
cp scripts/seed.example.json seed.local.json   # fill in the tokens; the file is git-ignored
export AWS_PROFILE=yevhenii AWS_REGION=us-east-1
export TABLE_NAME=$(cd infra/main && terraform output -raw table_name)
export APP_URL=$(cd infra/main && terraform output -raw app_url)
pnpm seed:user --file seed.local.json --api-url "$(cd infra/main && terraform output -raw api_url)"
# send /start to the bot (or add it as admin to a channel and post anything), then:
pnpm poller:local --user smoke-test-user --dry-run   # real Freelancer + Bedrock calls, no writes, no Telegram
pnpm poller:local --user smoke-test-user             # writes matches and sends Telegram messages
aws logs tail /aws/lambda/gighunter-poller --since 30m --profile yevhenii --format short
```

## Cost controls

- Settings → **Job search ON/OFF** (`active`) stops all fetching and scoring for a user; **poll every** (`pollIntervalMinutes`) stretches the interval up to 24 h.
- At most 20 LLM scoring calls per platform per run (`MAX_SCORED_PER_RUN`); the deterministic pre-filter runs before any model call.
- Account-level AWS Budgets ($20/month and zero-spend) email `oldfromkb@gmail.com`.
