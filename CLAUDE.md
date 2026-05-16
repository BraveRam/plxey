# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication style

Talk like caveman. Drop articles, filler, hedging. Fragments OK. Technical terms exact, code blocks unchanged, errors quoted exact. Default level: full. Stay on every turn unless user says "stop caveman" or "normal mode". Override caveman only for: security warnings, irreversible-action confirmations, multi-step instructions where omitted conjunctions risk misread.

Also see `AGENTS.md` for the same architecture overview in slightly more detail.

## Commands

```sh
bun install               # install deps
bun test                  # run all tests (bun's built-in runner)
bun test apps/bot/tests/registry.test.ts   # run one test file
bun test -t "name"        # filter by test name
bun run bot               # start bot server on :3000 (set LOG_LEVEL=debug for pino-pretty verbose)
bun run rag               # start RAG worker on :3001 (set INNGEST_DEV=1 for local Inngest dev)
bun run db:push           # bunx drizzle-kit push — sync schema to Neon
bunx drizzle-kit generate # generate a versioned migration in drizzle/
```

There is no separate lint/typecheck script — TypeScript is checked implicitly by Bun at runtime, and `tsconfig.json` is set to `noEmit`. If you need an explicit type pass, run `bunx tsc --noEmit`.

## Architecture

Bun workspace monorepo. Two deployable apps plus three shared packages.

### Apps

- **`apps/bot`** (Hono on :3000) — single entry `apps/bot/src/index.ts` mounts:
  - Telegram webhooks (multiple bots, one per tenant) dispatched by `bots/registry.ts` (`BotRegistry`: lazy-loads tenant bots from DB, caches them, decrypts tokens via `@tg-business/crypto`)
  - Onboarding bot in `bots/onboarding.ts` (uses `@grammyjs/conversations`)
  - REST API at `/api/*` in `api/routes.ts` — tenants, bots, documents (consumed by the Mini App, and by the bot itself via `api/client.ts`)
  - AI chat in `services/ai.ts` (Vercel AI SDK + AI Gateway). Two tools: `get_information` (RAG via `services/retrieval.ts`, pgvector cosine similarity) and `send_admin_message`.

- **`apps/rag`** (Hono on :3001) — Inngest-driven PDF pipeline in `src/ingest.ts`:
  download from B2 → `pdf-parse` → `chunker.ts` recursive splitter → embed via AI Gateway → insert into pgvector. Bot triggers it by sending an Inngest event over HTTP.

### Packages

- **`@tg-business/db`** — Drizzle schema (`packages/db/src/schema.ts`) + client. Uses `@neondatabase/serverless` HTTP driver (no `pg`/node-postgres). pgvector + HNSW index is set up via migration.
- **`@tg-business/crypto`** — AES-GCM wrapper for encrypting tenant bot tokens at rest. Used by `BotRegistry`.
- **`@tg-business/storage`** — Backblaze B2 upload/download/delete.

### Communication graph

```
Telegram ──webhook──> bot ──HTTP (Inngest event)──> rag
Mini app ──HTTP──> bot /api/*
bot     ──HTTP──> bot /api/*   (own API via api/client.ts)
```

### Scoping invariants (load-bearing, watch when touching the DB layer)

- **Conversations** are keyed per **business connection**, not per `(tenant, chat)`.
- **Documents** are keyed per **bot**, not per tenant. Both showed up in recent commits — don't widen these scopes back.

## TypeScript quirks

- `verbatimModuleSyntax: true` — must use `import type { ... }` for type-only imports
- `moduleResolution: "bundler"` — do **not** add `.js` extensions to relative imports
- `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride` are on; array/object index access returns `T | undefined`

## Testing

Tests live in `apps/*/tests/` and use Bun's built-in test runner. They are unit tests for isolated modules (crypto, chunker, registry, admin-reply-targets) — there is no integration suite hitting Neon/AI Gateway. When testing `BotRegistry`, inject `InMemoryAdminReplyTargets` via the constructor instead of the default `DbAdminReplyTargets`.

TDD is required per `AGENTS.md`: write a failing test, then the minimum code to pass it.

## Required env vars

`BOT_TOKEN`, `DATABASE_URL`, `AI_GATEWAY_API_KEY`, `PUBLIC_URL` (ngrok or prod URL for webhooks), `ENCRYPTION_KEY` (≥32 chars for AES-GCM), `B2_APPLICATION_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_ID`, optional `INNGEST_DEV=1`, optional `EMBEDDING_MODEL` (default `openai/text-embedding-3-small`). See `.env.example`.

Never put real env values in tests, fixtures, or any committed file — `.env` is gitignored and must stay that way.
