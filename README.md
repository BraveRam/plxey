# tg-business

Multitenant Telegram Business support bot SaaS with AI.

tg-business allows business owners to connect their Telegram Business accounts to custom AI support bots. When customers message a business on Telegram, the bot retrieves context from uploaded knowledge base documents, generates accurate responses using large language models, and replies directly inside the chat as the business account. If the AI cannot answer, it escalates to the owner with one-tap reply forwarding across any media type.

---

## Key Features

- Multitenant Telegram Business Integration: Business owners register bots via an onboarding bot, link their Telegram Business account, and configure customer service automation.
- Retrieval-Augmented Generation (RAG): Documents are parsed, chunked, and embedded into a Neon PostgreSQL database using pgvector. Fast cosine similarity search provides grounding for AI responses.
- Multiformat Ingestion Pipeline: Supports PDF, DOCX, HTML, Markdown, and plain text files. Files are stored in Backblaze B2, processed asynchronously with Inngest, and embedded in batches.
- Human-in-the-Loop Escalation: When the AI cannot resolve an inquiry, it alerts the owner via Telegram DM. The owner can reply directly in any media format (text, photo, voice, video note, document, sticker, location) and have it forwarded to the customer through the business connection.
- Telegram Stars Subscriptions: Built-in billing using Telegram Stars (XTR) with automated subscription lifecycle management (Trial, Pro, and Business tiers), plan quotas, and Inngest cron jobs for reconciliation and lapse handling.
- Owner Telegram Mini App: React 19 single-page app launched from the onboarding bot to manage bots, upload documents, inspect analytics, manage subscriptions, and access the operator admin dashboard.
- Marketing Landing Page: Lightweight showcase website built with React 19 and Tailwind CSS.
- Layered Security and Rate Limiting: AES-256-GCM encryption for bot tokens at rest, Telegram initData HMAC validation for API calls, timing-safe webhook verification, and multi-tier sliding-window rate limiting backed by Upstash Redis.

---

## Monorepo Layout

```
tg-business/
+-- apps/
|   +-- bot/                  # Main Hono server: webhooks, REST API, BotRegistry, AI chat (port 3000)
|   +-- rag/                  # RAG worker: Inngest document ingestion pipeline (port 3001)
|   +-- miniapp/              # Owner-facing Telegram Mini App (Vite, React 19, Tailwind CSS v4)
|   \-- landing/              # Marketing landing page (Vite, React 19, Tailwind CSS v4)
+-- packages/
|   +-- db/                   # Drizzle ORM schema and Neon HTTP serverless client (pgvector)
|   +-- crypto/               # AES-256-GCM encryption for bot tokens at rest
|   \-- storage/              # Backblaze B2 upload, download, and deletion helpers
+-- drizzle/                  # SQL migrations and schema journals
+-- package.json              # Bun workspace root definition and shared scripts
\-- tsconfig.json             # Root TypeScript configuration
```

### Applications

- `apps/bot` (Hono, default port 3000):
  - Onboarding bot (`apps/bot/src/bots/onboarding.ts`): Guides owners through token submission, bot activation, management, and billing.
  - Tenant Bot Registry (`apps/bot/src/bots/registry.ts`): Lazy-loads and caches tenant bots, decrypts credentials, routes webhooks, and manages customer conversations.
  - AI and Retrieval Service (`apps/bot/src/services/`): Connects to the Vercel AI SDK and AI Gateway with tools for document retrieval and owner escalation.
  - REST API (`apps/bot/src/api/routes.ts`): REST endpoints consumed by the Mini App, authenticated via Telegram `initData` HMAC.
  - Inngest Functions (`apps/bot/src/inngest/`): Background crons for trial sweeps, lapse handling, reminder scans, and usage reconciliation.

- `apps/rag` (Hono, default port 3001):
  - Inngest Worker (`apps/rag/src/ingest.ts`): Downloads uploaded documents from Backblaze B2, extracts text using format-specific parsers, splits content recursively into chunks, generates vector embeddings, and stores them in Neon Postgres.
  - Document Parsers (`apps/rag/src/parsers/`): Dedicated parsers for PDF (`pdf-parse`), DOCX (`mammoth`), HTML, and plain text / Markdown.

- `apps/miniapp` (Vite, React 19, Tailwind CSS v4):
  - Client interface for business owners to manage bot settings, upload and delete knowledge base documents, view conversation analytics, review permissions, and manage subscriptions.
  - Includes an operator-only admin dashboard for cross-tenant metrics and owner moderation.

- `apps/landing` (Vite, React 19, Tailwind CSS v4):
  - Marketing landing page for the SaaS product.

### Shared Packages

- `@tg-business/db`: Drizzle ORM schema with Neon serverless HTTP driver, custom `vector(1536)` pgvector types, and table definitions.
- `@tg-business/crypto`: AES-256-GCM encryption and decryption utilities using the Web Crypto API.
- `@tg-business/storage`: Backblaze B2 client for file storage.

---

## Tech Stack

- Runtime: Bun
- Web Framework: Hono
- Telegram Bot Framework: grammY with conversations and rate-limiter plugins
- Telegram Web App: @twa-dev/sdk
- Database: Neon Serverless PostgreSQL with pgvector extension
- ORM: Drizzle ORM
- Object Storage: Backblaze B2
- Cache and Rate Limiting: Upstash Redis
- Background Jobs and Crons: Inngest
- LLM and Embeddings: Vercel AI SDK with AI Gateway (deepseek-v4-flash, gemini-2.5-flash-lite, text-embedding-3-small)
- Frontend: React 19, Vite, Tailwind CSS v4, Radix UI, Lucide Icons, Recharts

---

## Architecture and Data Flow

```
[Customer on Telegram]
        |
        v (Business Message)
[Tenant Bot Webhook] ---------> [BotRegistry (apps/bot)]
                                      |
                                      +--> [pgvector Semantic Search]
                                      |        ^
                                      |        | (Batch Ingestion)
                                      |   [RAG Worker (apps/rag)] <---> [Backblaze B2]
                                      |
                                      +--> [AI SDK / Gateway]
                                      |
                                      +--> [Reply via Business Connection]
                                      |
                                      +--> (Escalation) ---> [Owner Telegram DM]
                                                                   |
                                                                   v (Owner Media Reply)
                                                             [Customer Chat]
```

---

## Plans and Quotas

| Plan | Telegram Stars / Month | Max Bots | Max Docs per Bot | Max Messages per Period |
|---|---|---|---|---|
| Trial (7 days) | 0 | 1 | 3 | 500 (single bucket) |
| Pro | 300 | 3 | 10 | 5,000 |
| Business | 700 | 10 | 50 | 50,000 |

Business plan includes vision model capabilities for customer photo queries.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the required values:

```sh
cp .env.example .env
```

| Variable | Description |
|---|---|
| `BOT_TOKEN` | Telegram Bot token for the onboarding bot from @BotFather |
| `DATABASE_URL` | Neon PostgreSQL connection string (HTTP serverless) |
| `AI_GATEWAY_API_KEY` | API key for Vercel AI Gateway |
| `PUBLIC_URL` | Public base URL for webhook endpoints (ngrok for local dev) |
| `ENCRYPTION_KEY` | Secret key (minimum 32 characters) for AES-256-GCM token encryption |
| `WORKER_URL` | Base URL for the RAG worker (e.g. `http://localhost:3001`) |
| `ONBOARDING_WEBHOOK_SECRET` | Secret token for onboarding bot webhook verification |
| `B2_APPLICATION_KEY_ID` | Backblaze B2 Application Key ID |
| `B2_APPLICATION_KEY` | Backblaze B2 Application Key |
| `B2_BUCKET_ID` | Backblaze B2 Bucket ID |
| `B2_BUCKET_NAME` | Backblaze B2 Bucket Name |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST Token |
| `ADMIN_TELEGRAM_USER_ID` | Numeric Telegram user ID of the SaaS operator |
| `MINIAPP_ORIGIN` | Allowed origin for Mini App CORS and WebApp menu button |
| `AI_MODEL` | Default chat model (default: `deepseek/deepseek-v4-flash`) |
| `AI_MODEL_BUSINESS` | Vision model for Business tier (default: `google/gemini-2.5-flash-lite`) |
| `EMBEDDING_MODEL` | Embedding model (default: `openai/text-embedding-3-small`) |
| `INNGEST_DEV` | Set to `1` when running local Inngest development server |

---

## Getting Started

### 1. Install Dependencies

```sh
bun install
```

### 2. Database Setup

Push the Drizzle schema to your Neon Postgres database:

```sh
bun run db:push
```

To generate versioned migration files instead:

```sh
bunx drizzle-kit generate
```

### 3. Run Services Locally

Start the Bot server (port 3000):

```sh
bun run bot
```

Start the RAG ingestion worker (port 3001):

```sh
bun run rag
```

Start the Mini App (Vite dev server on port 5173):

```sh
cd apps/miniapp && bun run dev
```

Start the Landing Page (port 5173 or next available port):

```sh
cd apps/landing && bun run dev
```

---

## Testing

Run the test suite using Bun's built-in test runner:

```sh
bun test
```

Run a specific test file:

```sh
bun test apps/bot/tests/registry.test.ts
```

Filter tests by name:

```sh
bun test -t "quota"
```

Type-checking:

```sh
bunx tsc --noEmit
```

---

## Documentation

For in-depth architecture, data schemas, update matrices, and edge-case behaviors, refer to:

- `DOCUMENTATION.md`: System reference manual.
- `SUBSCRIPTION.md`: Telegram Stars billing design specification.
- `AGENTS.md`: Development guidelines and architecture reference.

