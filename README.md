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
