# tg-business

Multitenant Telegram Business support bot with AI.

## Commands

```sh
bun install          # install deps
bun test             # run all tests (18 tests, tests/ dir)
bun src/index.ts     # start dev server
bun drizzle-kit push # sync schema to Neon DB
```

## TDD (required)

Write a failing test first, then minimal code. Never production code without a failing test before it.

## Architecture

Single Hono server (`src/index.ts`) running on Bun. Two kinds of routes:

- **Webhooks** (`/webhook/onboarding`, `/webhook/tenant/:id`) — Telegram bot updates
- **API** (`/api/*`) — REST routes for tenants and bots (used by bot handlers internally via `fetch` + by the future mini-app)

Two bot types:
- **Onboarding bot** (`src/bots/onboarding.ts`) — inline menu + conversations, lets owners register bots, set prompts, manage
- **Tenant bots** (`src/bots/registry.ts`) — per-tenant grammy Bot instances, lazy-loaded on webhook. Handle business messages via AI, fallback to owner, owner replies

## Key modules

| File | Role |
|------|------|
| `src/api/routes.ts` | REST API routes (tenants, bots CRUD) |
| `src/api/client.ts` | fetch-based client the bot uses to call API |
| `src/bots/registry.ts` | BotRegistry: lazy-load, cache, handler wiring |
| `src/bots/onboarding.ts` | Onboarding bot with conversations |
| `src/bots/admin-reply-targets.ts` | Reply target storage (DB + in-memory for tests) |
| `src/services/ai.ts` | AI SDK integration, tools (send_admin_message) |
| `src/lib/crypto.ts` | AES-GCM token encryption |
| `src/db/schema.ts` | Drizzle schema (tenants, bots, conversations, messages, admin_reply_targets) |

## Required env vars

- `BOT_TOKEN` — onboarding bot token
- `DATABASE_URL` — Neon Postgres connection string
- `AI_GATEWAY_API_KEY` — for Vercel AI SDK gateway (`ai` package)
- `PUBLIC_URL` — ngrok URL or production URL for webhooks
- `ENCRYPTION_KEY` — 32+ chars for AES-GCM bot token encryption

## DB

- Drizzle ORM with `@neondatabase/serverless` (HTTP driver, no pg)
- Migrations: `drizzle/` dir. Use `bun drizzle-kit push` for prototyping, `bun drizzle-kit generate` for migrations
- Vector extension + HNSW index already created for pgvector

## TypeScript quirks

- `verbatimModuleSyntax: true` — use `import type` for type-only imports
- `moduleResolution: "bundler"` — no `.js` extension in imports
- `strict`, `noUncheckedIndexedAccess` enabled

## Bot registry injection

`BotRegistry` accepts `AdminReplyTargets` via constructor for testability. Default is `DbAdminReplyTargets`. Tests use `InMemoryAdminReplyTargets` with shared Map.

## Tests

All under `tests/`. Run with `bun test`. Integration tests require DB/AI — currently only unit tests for isolated modules.

## Security

Never put real environment variable values in tests, docs, or any committed file. Use `.env.example` for documentation and fake/placeholder values in tests. `.env` is gitignored — keep it that way.
