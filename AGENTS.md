# tg-business

Multitenant Telegram Business support bot with AI.

## Commands

```sh
bun install               # install deps
bun test                  # run all tests (26 tests)
bun run bot               # start bot server (LOG_LEVEL=debug for verbose, pino-pretty)
bun run api               # start API server
bun run rag               # start RAG worker (INNGEST_DEV=1 for local dev)
bun drizzle-kit push      # sync schema to Neon DB
```

## TDD (required)

Write a failing test first, then minimal code. Never production code without a failing test before it.

## Architecture

### Services (3 deployable apps)

| App | Path | Port | Role |
|-----|------|------|------|
| **bot** | `apps/bot/src/index.ts` | 3000 | Telegram webhooks, BotRegistry, AI chat, PDF ingestion |
| **api** | `apps/api/src/index.ts` | 3001 | REST CRUD for tenants, bots, documents |
| **rag** | `apps/rag/src/server.ts` | 3002 | PDF processing pipeline (download → parse → chunk → embed → pgvector) |

### Shared packages

| Package | Path | Used by | Contents |
|---------|------|---------|----------|
| `@tg-business/db` | `packages/db/` | all 3 | Drizzle schema + client |
| `@tg-business/crypto` | `packages/crypto/` | bot, api | AES-GCM encrypt/decrypt |
| `@tg-business/storage` | `packages/storage/` | bot, api, rag | B2 upload/download/delete |

### Key modules

| File | Role |
|------|------|
| `apps/bot/src/bots/registry.ts` | BotRegistry: lazy-load, cache, handler wiring |
| `apps/bot/src/bots/onboarding.ts` | Onboarding bot with conversations |
| `apps/bot/src/bots/admin-reply-targets.ts` | Reply target storage (DB + in-memory for tests) |
| `apps/bot/src/services/ai.ts` | AI SDK integration, tools (get_information, send_admin_message) |
| `apps/bot/src/services/retrieval.ts` | pgvector cosine similarity search |
| `apps/bot/src/api/client.ts` | fetch-based client the bot uses to call API |
| `apps/api/src/routes.ts` | REST API routes (tenants, bots, documents) |
| `apps/rag/src/ingest.ts` | Inngest processPdf function |
| `apps/rag/src/chunker.ts` | Recursive text splitter |

## Communication

```
Telegram ←→ bot ──HTTP──→ api (CRUD)
                   ──HTTP──→ rag (PDF ingest)
Mini app  ──HTTP──→ api (CRUD)
```

## Required env vars

- `BOT_TOKEN` — onboarding bot token
- `DATABASE_URL` — Neon Postgres connection string
- `AI_GATEWAY_API_KEY` — for Vercel AI SDK gateway
- `PUBLIC_URL` — ngrok URL or production URL for webhooks
- `ENCRYPTION_KEY` — 32+ chars for AES-GCM bot token encryption
- `B2_APPLICATION_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_ID` — Backblaze B2
- `INNGEST_DEV` — set to `1` for local Inngest dev server
- `EMBEDDING_MODEL` — default: `openai/text-embedding-3-small`

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

Tests in `apps/bot/tests/` and `apps/rag/tests/`. Run with `bun test` from root. Integration tests require DB/AI — currently only unit tests for isolated modules.

## Security

Never put real environment variable values in tests, docs, or any committed file. Use `.env.example` for documentation and fake/placeholder values in tests. `.env` is gitignored — keep it that way.
