# tg-business — System Documentation

> Comprehensive technical reference for the multi-tenant Telegram Business support-bot SaaS. Covers architecture, data model, flows, services, security, ops, and known gaps. Backed by code at the cited file paths.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Repository Layout](#repository-layout)
3. [Application Components](#application-components)
4. [Bot Middleware Chains](#bot-middleware-chains)
5. [Conversation Flows](#conversation-flows)
6. [Owner Reply Flow (admin → customer)](#owner-reply-flow-admin--customer)
7. [Inter-process Communication](#inter-process-communication)
8. [Update-type Handling Matrix](#update-type-handling-matrix)
9. [Database Schema](#database-schema)
10. [Enums](#enums)
11. [Vector Column & Indexing](#vector-column--indexing)
12. [Migrations Inventory](#migrations-inventory)
13. [Shared Packages](#shared-packages)
14. [RAG Pipeline](#rag-pipeline)
15. [Per-bot vs Per-tenant Scoping (Critical)](#per-bot-vs-per-tenant-scoping-critical)
16. [AI Subsystem](#ai-subsystem)
17. [RAG Retrieval](#rag-retrieval)
18. [REST API (`/api/*`)](#rest-api-api)
19. [Rate Limiting (Layered)](#rate-limiting-layered)
20. [Persistent State in Redis (Upstash)](#persistent-state-in-redis-upstash)
21. [Security Model](#security-model)
22. [Environment Variables](#environment-variables)
23. [User-facing Text Constants](#user-facing-text-constants)
24. [Logging](#logging)
24. [Commands (Developer Workflow)](#commands-developer-workflow)
25. [Testing](#testing)
26. [TypeScript Configuration Quirks](#typescript-configuration-quirks)
27. [Deployment Notes](#deployment-notes)
28. [Versioning & Dependencies](#versioning--dependencies)
29. [Project Conventions](#project-conventions)
30. [Known Gaps & Future Work](#known-gaps--future-work)

---

## System Overview

This is a multi-tenant SaaS platform that lets business owners ("tenants") add an AI-powered Telegram customer-support bot to their Telegram Business account. There are three actors: the SaaS operator who runs the infrastructure, tenant business owners who register their own bots via the onboarding bot, and customers who chat directly with the business owner's Telegram Business account. When a customer sends a message, Telegram routes it to the tenant's bot via a Business Connection; the bot queries a vector knowledge base, calls an LLM, and replies as the business. When the AI cannot answer, it escalates to the owner's DM with a one-shot Reply button so the owner can respond directly in any media type.

---

## Repository Layout

```
tg-business/
├── apps/
│   ├── bot/                  # Main Hono server: webhooks, REST API, tenant bot registry
│   │   └── src/
│   │       ├── index.ts      # Entry point; mounts routes and starts Bun.serve on :3000
│   │       ├── api/          # REST API routes consumed by Mini App and internal callers
│   │       ├── bots/         # Bot factories: onboarding bot, tenant bot registry, helpers
│   │       ├── lib/          # Shared utilities: sequentialize, business-reply, rate limits, text constants, etc.
│   │       └── services/     # AI handler (ai.ts) and RAG retrieval (retrieval.ts)
│   └── rag/                  # RAG worker: Inngest-driven document ingestion pipeline on :3001
│       └── src/
│           ├── server.ts     # Hono entry point; mounts /ingest, /upload-and-ingest, /api/inngest
│           ├── ingest.ts     # Inngest function: extract → chunk → embed → store → notify
│           ├── chunker.ts    # Recursive text splitter (500-char chunks, 50-char overlap)
│           └── parsers/      # Per-format text extractors: pdf, docx, html, text/markdown
├── packages/
│   ├── db/                   # Drizzle schema + Neon serverless client; exports all table refs
│   ├── crypto/               # AES-GCM encrypt/decrypt wrapper for bot tokens at rest
│   └── storage/              # Backblaze B2 upload/download/delete helpers
├── drizzle/                  # Versioned SQL migrations and journal
├── package.json              # Bun workspace root; shared deps (grammy, ai, drizzle, inngest…)
└── tsconfig.json             # Shared TS config (bundler resolution, strict, verbatimModuleSyntax)
```

---

## Application Components

### apps/bot (Hono, port 3000)

**Hono mount points**

| Route | What it serves |
|---|---|
| `POST /webhook/onboarding` | Receives Telegram updates for the onboarding bot (`BOT_TOKEN`); verifies `X-Telegram-Bot-Api-Secret-Token` header, delegates to `onboardingBot.handleUpdate` |
| `POST /webhook/tenant/:id` | Receives Telegram updates for a tenant bot identified by UUID; looks up the bot in `BotRegistry`, verifies per-bot webhook secret, delegates to `bot.handleUpdate` |
| `/api/*` | REST API sub-router (see [REST API](#rest-api-api)) |
| `GET /health` | Liveness check; returns `200 OK` |

**Telegram update types consumed**

- Onboarding bot: `message` (text — token input, confirmation phrase), `callback_query`.
- Tenant bot: `message` (owner DMs, reply forwarding), `callback_query` (management menu, oreply/cancel callbacks), `business_message` (customer messages via Business Connection), `business_connection` (connection established/revoked/rights changed). `edited_business_message` and `deleted_business_messages` arrive but have no dedicated handler; they're excluded from the owner-side rate limiter via `isBusinessChatUpdate`.

**External services called**

- Telegram Bot API (grammY): `setWebhook`, `sendMessage`, `sendChatAction`, `readBusinessMessage`, `getBusinessConnection`, `getFile`, per-type `sendXxx` for forwarding.
- Neon (PostgreSQL via `@neondatabase/serverless`): all DB reads/writes.
- Upstash Redis: session storage, conversation storage, rate-limit counters, permission-alert NX locks.
- AI Gateway (`process.env.AI_GATEWAY_API_KEY`): LLM inference (`generateText`) and embedding (`embed`) via Vercel AI SDK.
- RAG worker (`process.env.WORKER_URL`): `POST /ingest` with JSON body to trigger document processing.

### apps/rag (Hono, port 3001)

**Hono mount points**

| Route | What it serves |
|---|---|
| `POST /ingest` | Accepts JSON `{b2FileId, b2FileName, tenantId, botId, fileName, mimeType}`; inserts a `documents` row with status `processing`, fires `rag/document.ingest` Inngest event; returns `{documentId, status:"queued"}` 202 |
| `GET /ingest/:documentId` | Returns document status (`processing`/`ready`/`failed`) |
| `POST /upload-and-ingest` | Accepts raw binary body with `X-Tenant-Id`/`X-Bot-Id` headers; uploads to B2, then proceeds as `/ingest` |
| `ALL /api/inngest` | Inngest serve handler; Inngest cloud delivers the `rag/document.ingest` event here |

**External services called**

- Inngest: event send (`inngest.send`) and function execution handler.
- Backblaze B2 (`@tg-business/storage`): `downloadFileById` for the raw file.
- Neon: inserts to `documents`, `document_chunks`; updates document status.
- AI Gateway: `embedMany` for batch chunk embedding.
- Telegram Bot API (raw `fetch`): owner notification on completion.

### apps/miniapp (Vite + React, deployed to Vercel)

Owner-facing Telegram Mini App, launched from the onboarding bot's chat menu button (`setChatMenuButton` web_app, wired in `index.ts` from `MINIAPP_ORIGIN`). Static SPA — **not** part of the bot/rag Docker images; it deploys separately to Vercel (Root Directory `apps/miniapp`, `bun run build` → `dist`, `vercel.json` SPA rewrite). Because it lives on a different origin from the bot API (Koyeb), the API has CORS + initData auth.

- **Stack**: React 19, Vite, TypeScript, Tailwind v4, shadcn/ui (vendored in `src/components/ui`), TanStack Query, react-router, `@twa-dev/sdk`, sonner.
- **Telegram bridge** (`src/lib/telegram.ts`): `WebApp.ready()/expand()`, maps `themeParams` onto shadcn CSS variables (light/dark follows `colorScheme`), exposes signed `initData`, native BackButton, haptics.
- **API client** (`src/lib/api.ts`): base `VITE_API_BASE` (= bot `PUBLIC_URL`); sends `Authorization: tma <initData>` on every request.
- **Screens**: BotList, ConnectBot (paste BotFather token → `POST /api/bots`), BotDetail (tabs: Settings / Knowledge / Stats / Access), Billing.
- **Env**: `VITE_API_BASE`. The bot side needs `MINIAPP_ORIGIN` for CORS + the menu button.

---

## Bot Middleware Chains

### Onboarding bot

Middleware applied in mount order in `apps/bot/src/bots/onboarding.ts`:

1. **Rate limiter** — `@grammyjs/ratelimiter`, `limit: 20`, `timeFrame: 60_000` ms, `keyPrefix: "onboarding:"`, key = `ctx.from?.id.toString()`. Silent drop. Applied before any queue work.
2. **sequentializeByChat** — custom in-process per-chat promise chain (`lib/sequentialize.ts`). Prevents concurrent updates from the same `chat.id` from racing on the conversations replay log.
3. **session** — grammY session middleware; `initial: () => ({})`, `storage: new UpstashSessionStorage("tg:session:onboarding:")`.
4. **conversations** — `@grammyjs/conversations`; `storage: { type: "key", adapter: new UpstashSessionStorage("tg:conv:onboarding:") }`.
5. **createConversation("createBot")** — `createBotConversation`.
6. **createConversation("deleteBot")** — `deleteBotConversation` (receives `botId` as entry arg).
7. **Command/callback handlers** — `/start`, `/help`, `/privacy`, `/terms`, `create_bot`, `manage`, `bot_*`, `pause_*`, `resume_*`, `delete_*`, `menu`, catch-all `callback_query:data`. Plus `/billing` mounted by `attachBillingHandlers`. `/privacy` and `/terms` reply with the `PRIVACY_POLICY` and `TERMS_OF_SERVICE` constants from `lib/text.ts`; they fire `onboarding.privacy.opened` / `onboarding.terms.opened` events to PostHog.
8. **Slash-menu autocomplete** — registered once at boot via `bot.api.setMyCommands([...])` (global scope, fire-and-forget) so the five commands (`/start`, `/help`, `/billing`, `/privacy`, `/terms`) appear in Telegram's `/` picker.

### Tenant bot (per-business)

Built by `buildBizBot(rawToken, botId, tenantId)` in `BotRegistry`; handlers attached separately by `attachHandlers`.

1. **Owner-side rate limiter** — applied only to non-business-chat updates (`bot.filter((ctx) => !isBusinessChatUpdate(ctx.update))`). `limit: 30`, `timeFrame: 60_000` ms, `keyPrefix: "bot:{botId}:"`, key = `ctx.from?.id.toString()`. Silent drop. Business-chat updates (`business_message`, `edited_business_message`, `business_connection`, `deleted_business_messages`) bypass entirely.
2. **sequentializeByChat** — same custom middleware as onboarding bot.
3. **session** — `initial: () => ({})`, `storage: new UpstashSessionStorage("tg:session:bot:{botId}:")`. Per-bot prefix mandatory — two tenant bots can serve the same `chatId`.
4. **conversations** — `storage: { type: "key", adapter: new UpstashSessionStorage("tg:conv:bot:{botId}:") }`.
5. **createConversation("editPrompt")** — `makeEditPromptConversation(botId)`.
6. **createConversation("editWelcome")** — `makeEditWelcomeConversation(botId, onSaved)`.
7. **createConversation("documentMgmt")** — `makeDocumentManagementConversation(botId, tenantId, rawToken)`.
8. **Handlers** (via `attachHandlers`) — `/start`, management-menu callback queries, `business_connection`, `business_message` (with inline filter), `message` (owner DM + reply forwarding), catch-all `callback_query:data`.

Customer `business_message` updates additionally pass through two runtime checks before the AI call: a `can_reply` pre-flight (alerts owner once per 30 min via Redis NX+EX slot if permission is missing) and a per-customer Upstash rate limit of 10 messages / 60 s keyed on `{botId}:{customerTelegramUserId}`.

---

## Conversation Flows

### createBot

Entered when the owner taps "Create Bot" (`create_bot` callback). No arguments.

1. Deletes the triggering button message; sends a prompt asking for the BotFather token with a Cancel button.
2. Loops on `conversation.wait()`:
   - Cancel → deletes screen, shows bot list, exits.
   - Stale callback → main menu, exits.
   - Text token → deletes user's message (removes the secret from chat history); inside `conversation.external`: `createBot(token, userId)` (writes `tenants` + `tenant_bots`, calls Telegram `getMe`), then `setWebhook` on a fresh `Bot(token)` pointing at `/webhook/tenant/{botId}` with the per-bot secret.
   - Invalid token → re-prompt.
3. On success: instructions to open Telegram Business settings; exits to main menu.

Side effects (all wrapped in `conversation.external` for replay safety): DB inserts for tenant + tenant_bot, Telegram `setWebhook`.

### deleteBot

Entered when the owner taps the delete button for a specific bot (`delete_{botId}` callback). Receives `botId` as `conversation.enter` argument.

Confirmation phrase required verbatim: `"Yes, I am totally sure."`

1. Deletes triggering message; sends a warning with the exact phrase in `<code>` and a Cancel button.
2. Loops on `conversation.wait()`:
   - Cancel → bot list, exits.
   - Stale callback → main menu, exits.
   - Any incoming message → immediately deletes the user's message (to keep the phrase out of chat history).
   - Text ≠ phrase → re-prompt with error.
   - Text = phrase → inside `conversation.external`: `deleteBot(botId)` (DB delete cascades; registry eviction). Shows updated bot list.

### editPrompt

Entered when the owner taps "Edit Prompt". Created per-bot by `makeEditPromptConversation(botId)`.

1. Fetches current prompt; deletes triggering message; sends current prompt with Cancel button.
2. Loop:
   - Cancel (`biz_cancel`) → management menu, exits.
   - Stale callback → management menu, exits.
   - Non-text → re-prompt.
   - Text → inside `conversation.external`: `updateBot(botId, { systemPrompt: newPrompt })`. Shows "Prompt updated!" then management menu.

### editWelcome

Entered when the owner taps "Welcome Message". Created per-bot by `makeEditWelcomeConversation(botId, onSaved)`. `onSaved` updates `BotEntry.welcomeMessage` in memory without a registry reload.

1. Shows current welcome (or default note) with "Reset to default" + Cancel.
2. Loop:
   - Cancel → management menu, exits.
   - Reset (`biz_welcome_reset`) → `updateBot(botId, { welcomeMessage: null })` + `onSaved(null)`. Confirms, exits.
   - Stale callback → management menu, exits.
   - Non-text → re-prompt.
   - Text → `updateBot(botId, { welcomeMessage: newWelcome })` + `onSaved(newWelcome)`. Confirms, exits.

### documentMgmt

Entered when the owner taps "Documents". Created per-bot by `makeDocumentManagementConversation(botId, tenantId, rawToken)`. The "screen" is tracked by `screenMsgId`; each state transition deletes the previous message and posts a new one.

Dispatches on callback data:

- `biz_doc_back` → management menu, exits. Clears `inBatchUpload`.
- `biz_doc_cancel` → re-shows docs list. Clears `inBatchUpload`.
- `biz_doc_done` → exit batch upload mode, re-shows docs list.
- `biz_add_doc` → checks plan quota + `MAX_DOCUMENTS_PER_BOT`; if under limit, sends the batch upload prompt (`docAddPrompt`, keyboard `[Cancel] [✅ Done]`) and flips `inBatchUpload = true`.
- `biz_docitem_{id}` → answers with delete hint, stays in loop.
- `biz_del_doc_{id}` → shows confirm-delete screen.
- `biz_confirm_del_{id}` → `deleteDocument(docId)`; re-shows list.
- Stale callback → management menu, exits.
- Text `/done` (when `inBatchUpload`) → re-shows docs list.
- Document message:
  1. `detectMimeType`.
  2. Re-runs the plan-cap quota gate, `MAX_DOCUMENTS_PER_BOT`, and `MAX_DOCUMENT_SIZE_BYTES` checks per file (batch-safe).
  3. `ctx.api.getFile` to resolve `file_path`.
  4. Inside `conversation.external`: fetch raw bytes from Telegram CDN, upload to B2 under `tenants/{tenantId}/docs/{uuid}.{ext}`, POST to `{WORKER_URL}/ingest`.
  5. Replies `✅ Document queued.` then, if still in batch mode, re-posts the `DOC_BATCH_PROMPT` ("Send another document or press /done.") with the `[Cancel] [✅ Done]` keyboard at the bottom of the chat. Outside batch mode, falls back to re-rendering the full docs list.

**Batch upload mode**: tapping ➕ Add Document enters a sub-mode where the owner can drop multiple files into the chat back-to-back. The docs list is *not* re-rendered between uploads; instead a single rolling prompt sits at the bottom of the chat. The owner exits the batch by sending `/done`, tapping ✅ Done, or tapping Cancel — all three return them to the docs list. Each file is still uploaded, queued, and ingested individually (one `documents` row, one `rag/document.ingest` event per file); only the UI is batched.

---

## Owner Reply Flow (admin → customer)

1. **AI escalation trigger** (`registry.ts:1226`): inside the `business_message` handler, `askAI` is called with a `sendAdminMessage` callback. When the LLM calls the `send_admin_message` tool (`services/ai.ts:29`), the callback runs.
2. **Token creation** (`registry.ts:1229`): `ownerReplyTargets.create({botId, chatId, businessConnectionId, customerLabel})`. `DbAdminReplyTargets.create` (`bots/admin-reply-targets.ts:138`) generates a 16-hex-char token (`randomUUID().replace(/-/g,"").slice(0,16)`), inserts an `admin_reply_targets` row with `tenantBotId`, `telegramChatId`, `businessConnectionId`, `customerLabel`, and `usedAt = null`.
3. **Owner notification** (`registry.ts:1234`): `ctx.api.sendMessage` to the owner with the customer label and AI-composed message, plus an inline button `"✏️ Reply"` with callback data `oreply_{token}`.
4. **Owner taps Reply** (`registry.ts:939`): `callbackQuery(/^oreply_([a-f0-9]{16})$/)` handler. `ownerReplyTargets.activate(ownerId, token)` marks the token selected and clears any prior active selection for that owner. Notification message is deleted. A "Send your reply" prompt is sent with a Cancel button (`oreply_cancel_{token}`); the prompt's `message_id` is stored via `ownerReplyTargets.setPromptMessageId`.
5. **Owner sends reply** (`registry.ts:1312`): `bot.on("message")` checks `ownerReplyTargets.getActive(ownerId)`. If active, `forwardMessageAsBusinessReply(ctx.api, ctx.message, state.chatId, state.businessConnectionId)` runs (`lib/business-reply.ts:20`).
6. **Per-type dispatch** (`lib/business-reply.ts:28`): inspects message type in order — `text`, `photo` (largest size), `voice`, `audio`, `video`, `video_note`, `animation` (checked before `document` since Telegram includes both fields on animations), `document`, `sticker`, `location`, `contact` — and calls the matching `api.sendXxx(toChatId, file_id, { business_connection_id })`. Returns `false` for unhandled types. `copyMessage` is *not* used because Telegram's Bot API does not accept `business_connection_id` on that method (confirmed against `@grammyjs/types@3.26.0` and the Bot API changelog).
7. **Cleanup** (`registry.ts:1341`): `ownerReplyTargets.markUsed(token)` sets `usedAt`. The prompt is deleted. Owner gets "Sent to customer".

**Cancel path** (`registry.ts:977`): `callbackQuery(/^oreply_cancel_([a-f0-9]{16})$/)` calls `markUsed(token)`, deletes the prompt, sends "Reply cancelled."

---

## Inter-process Communication

```
                     HTTPS (webhook)
Telegram ──────────────────────────────> apps/bot :3000
  POST /webhook/onboarding              X-Telegram-Bot-Api-Secret-Token header
  POST /webhook/tenant/:id              per-bot secret from tenant_bots.webhook_secret

                     HTTP (JSON)
Mini App / external ────────────────> apps/bot :3000 /api/*
                                       per-IP rate limit via Upstash (@upstash/ratelimit)
                                       no bearer auth (known gap)

                     HTTP (JSON)
apps/bot :3000 ──────────────────────> apps/bot :3000 /api/*
  (via lib/api.ts → fetch(PUBLIC_URL + "/api/..."))

                     HTTP (JSON, POST)
apps/bot :3000 ──────────────────────> apps/rag :3001 /ingest
  body: { b2FileId, b2FileName, tenantId, botId, fileName, mimeType }
  no auth header (trusted internal call)

                     HTTP (JSON)
Inngest cloud ───────────────────────> apps/rag :3001 /api/inngest
  delivers "rag/document.ingest" event; Inngest SDK verifies signature

                     HTTPS (Telegram Bot API, raw fetch)
apps/rag :3001 ──────────────────────> api.telegram.org/bot{token}/sendMessage
  owner notification on document ready
```

**Serialization**: all inter-service HTTP bodies are JSON. Webhook payloads from Telegram are JSON (Bot API Update objects).

**Auth summary**:
- Telegram→bot: `X-Telegram-Bot-Api-Secret-Token` header verified by `verifyWebhookSecret`.
- Mini App→bot API: per-IP Upstash rate limit (fail-open on Redis error); no bearer token.
- bot→bot `/api/*`: same rate limit applies.
- bot→rag `/ingest`: no auth; assumed internal network.
- Inngest→rag: signature verification inside `serve()`.

---

## Update-type Handling Matrix

| Telegram update type | Tenant bot — file:line | Onboarding bot — file:line |
|---|---|---|
| `message` | `registry.ts:1299` — if owner: active-reply check, forward as business reply, or management menu; if non-owner: customer welcome | conversation-only via `conversation.wait` |
| `callback_query` | `registry.ts:820–998` — management menu, `oreply_*`, `oreply_cancel_*`; catch-all `registry.ts:990` | `onboarding.ts:335–390` — `create_bot`, `manage`, `bot_*`, `pause_*`, `resume_*`, `delete_*`, `menu`; catch-all `onboarding.ts:386` |
| `business_message` | `registry.ts:1078` filter; handler `registry.ts:1112`: rate-limit, optional `readBusinessMessage`, conversation load/create, `askAI`, send reply with `business_connection_id` | n/a |
| `business_connection` | `registry.ts:1003` — read previous `isEnabled`, upsert row, refresh in-memory `BotEntry`, clear permission alert slot on re-grant, DM owner on `false→true` connect/reconnect transition (with extra warning if `can_reply` isn't granted) AND on `true→false` disconnect transition | n/a |
| `edited_business_message` | excluded from owner rate limiter by `isBusinessChatUpdate` (`lib/business-update.ts:17`); no dedicated handler | n/a |
| `deleted_business_messages` | excluded from owner rate limiter; no dedicated handler | n/a |
| `pre_checkout_query` | no handler (future: Stars subscriptions) | n/a |

---

## Database Schema

### tenants

Top-level SaaS customer account; owner of all bots, documents, and conversations.

| column | type | nullable | default | notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | primary key |
| name | text | no | — | display name |
| slug | text | no | — | URL-safe identifier; unique |
| telegram_owner_id | text | no | — | Telegram user ID of the owner |
| created_at | timestamptz | no | now() | |

**Indexes**: `tenants_slug_uq` unique on `(slug)`.

### tenant_bots

A Telegram bot registered under a tenant; each bot acts as a separate AI customer-support agent.

| column | type | nullable | default | notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | primary key |
| tenant_id | uuid | no | — | FK → tenants.id ON DELETE CASCADE |
| bot_token_encrypted | text | no | — | AES-GCM encrypted Telegram bot token |
| bot_username | text | yes | — | @username resolved from Telegram API |
| status | bot_status | no | 'active' | active / paused / revoked |
| webhook_secret | text | no | — | per-bot secret used to validate webhook calls |
| system_prompt | text | no | (default string) | LLM system prompt, used verbatim; no placeholder substitution — owners write the business name into the prompt directly |
| welcome_message | text | yes | — | optional greeting on Business Connection open |
| auto_read_business_messages | boolean | no | true | whether bot auto-marks incoming as read |
| connected_business_user_id | text | yes | — | Telegram business user ID linked after handshake |
| over_quota_at | timestamptz | yes | — | set when bot is paused due to plan-cap; null = active |
| daily_user_ai_reply_limit | integer | yes | — | owner-set per-end-user daily AI-reply cap; null = unlimited up to plan |
| daily_cap_reached_message | text | yes | — | owner-customizable text sent when an end-user hits the daily cap; null = use `DAILY_AI_CAP_REACHED_REPLY` default |
| created_at | timestamptz | no | now() | |

**Indexes**: `tenant_bots_tenant_idx` btree on `(tenant_id)`, `tenant_bots_over_quota_idx` btree on `(over_quota_at)`.

### business_connections

One row per Telegram Business Connection between a bot and a business account owner.

| column | type | nullable | default | notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | primary key |
| tenant_id | uuid | no | — | FK → tenants.id ON DELETE CASCADE |
| tenant_bot_id | uuid | no | — | FK → tenant_bots.id ON DELETE CASCADE |
| business_connection_id | text | no | — | Telegram-assigned; globally unique |
| telegram_user_id | text | no | — | business account owner's Telegram user ID |
| is_enabled | boolean | no | true | |
| rights | jsonb | yes | — | `Record<string, boolean \| undefined>` — granted rights from Business API |
| last_synced_at | timestamptz | yes | — | last time rights were refreshed |
| created_at | timestamptz | no | now() | |

**Indexes**: `business_connections_bc_uq` unique on `(business_connection_id)`, `_tenant_idx` on `(tenant_id)`, `_bot_idx` on `(tenant_bot_id)`.

**Scoping note**: conversations are keyed per `business_connection_id`, not per `(tenant, chat)`. This table is the authoritative source for that key.

### documents

Metadata for a file uploaded to a bot's knowledge base.

| column | type | nullable | default | notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | primary key |
| tenant_id | uuid | no | — | FK → tenants.id ON DELETE CASCADE |
| tenant_bot_id | uuid | yes | — | FK → tenant_bots.id ON DELETE CASCADE; scopes document to a bot |
| file_name | text | no | — | original file name |
| mime_type | text | no | — | drives parser selection |
| status | doc_status | no | 'processing' | processing / ready / failed |
| source | text | no | 'upload' | always 'upload' currently |
| b2_file_id | text | yes | — | Backblaze B2 file ID |
| b2_file_name | text | yes | — | B2 object path |
| created_at | timestamptz | no | now() | |

**Indexes**: `documents_tenant_idx` on `(tenant_id)`, `documents_bot_idx` on `(tenant_bot_id)`.

**Scoping note**: `tenant_bot_id` is the load-bearing scope column. Retrieval queries filter on `tenant_bot_id` — widening to `tenant_id` alone would leak documents across bots within the same tenant.

### document_chunks

Text chunks with 1536-dim embeddings.

| column | type | nullable | default | notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | primary key |
| tenant_id | uuid | no | — | FK; denormalized |
| tenant_bot_id | uuid | yes | — | FK; bot-level retrieval scope |
| document_id | uuid | no | — | FK → documents.id ON DELETE CASCADE |
| chunk_index | integer | no | — | 0-based position |
| content | text | no | — | raw chunk text |
| embedding | vector(1536) | yes | — | pgvector; matches text-embedding-3-small |
| metadata | jsonb | no | {} | reserved; currently always empty |
| created_at | timestamptz | no | now() | |

**Indexes**: `document_chunks_doc_chunk_uq` unique on `(document_id, chunk_index)`, `_tenant_idx`, `_bot_idx`.

### conversations

| column | type | nullable | default | notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | primary key |
| tenant_id | uuid | no | — | FK |
| business_connection_id | text | no | — | mirrors `business_connections.business_connection_id` |
| telegram_chat_id | text | no | — | customer's chat |
| last_message_at | timestamptz | no | now() | |
| created_at | timestamptz | no | now() | |

**Indexes**: `conversations_tenant_idx`, `conversations_bc_idx`.

**Scoping note**: scoped per `business_connection_id`, not per `(tenant_id, telegram_chat_id)`. Different business connections can serve the same chat ID.

### admin_reply_targets

Short-lived tokens for AI escalation → owner manual reply.

| column | type | nullable | default | notes |
|---|---|---|---|---|
| token | text | no | — | primary key; 16 hex chars embedded in callback data |
| tenant_bot_id | uuid | no | — | FK |
| telegram_chat_id | text | no | — | customer chat to forward reply to |
| business_connection_id | text | no | — | connection used to send reply |
| customer_label | text | yes | — | pre-rendered "👤 Name (@handle) — ID: 123" |
| selected_by_owner_telegram_id | text | yes | — | owner who activated the token |
| selected_at | timestamptz | yes | — | when owner tapped Reply |
| prompt_message_id | text | yes | — | message_id of the "Send your reply" prompt |
| used_at | timestamptz | yes | — | set when consumed |
| created_at | timestamptz | no | now() | |

**Indexes**: `admin_reply_targets_bot_idx` on `(tenant_bot_id)`, `_owner_idx` on `(selected_by_owner_telegram_id, selected_at)`.

### messages

Full chat history for LLM context.

| column | type | nullable | default | notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | primary key |
| tenant_id | uuid | no | — | FK; denormalized |
| conversation_id | uuid | no | — | FK → conversations.id |
| role | msg_role | no | — | user / assistant / system |
| content | text | no | — | message text |
| telegram_message_id | text | yes | — | cross-reference |
| token_count | integer | yes | — | for context budgeting |
| created_at | timestamptz | no | now() | |

**Indexes**: `messages_conv_idx` on `(conversation_id, created_at)`, `_tenant_idx`.

### conversation_summaries

| column | type | nullable | default | notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | primary key |
| tenant_id | uuid | no | — | FK |
| conversation_id | uuid | no | — | FK |
| summary | text | no | — | compressed narrative |
| last_message_id | uuid | yes | — | no FK constraint |
| updated_at | timestamptz | no | now() | |

**Indexes**: `conversation_summaries_conv_uq` unique on `(conversation_id)`.

### retrieval_events

Audit log of every RAG retrieval call.

| column | type | nullable | default | notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | primary key |
| tenant_id | uuid | no | — | FK |
| conversation_id | uuid | no | — | FK |
| message_id | uuid | yes | — | FK ON DELETE SET NULL |
| query | text | no | — | user query string |
| top_k | integer | no | — | requested count |
| hits | jsonb | no | — | `Array<{ chunkId: string; score: number }>` |
| created_at | timestamptz | no | now() | |

**Indexes**: `retrieval_events_tenant_idx`.

---

## Enums

| enum | values |
|---|---|
| `bot_status` | `active`, `paused`, `revoked` |
| `doc_status` | `processing`, `ready`, `failed` |
| `msg_role` | `user`, `assistant`, `system` |

---

## Vector Column & Indexing

- **Custom type**: `vector(1536)` declared via Drizzle's `customType` in `packages/db/src/schema.ts`. Maps `number[]` ↔ pgvector `vector(1536)`. Dimension 1536 matches `text-embedding-3-small`.
- **Embedding model**: `process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small"`. RAG worker and retrieval service must use the same value — changing without re-embedding produces incorrect cosine distances.
- **HNSW index**: **not yet present** in any migration file or schema. The `embedding` column has no vector-specific index; cosine searches do a sequential scan. Becomes a concern as chunk count grows.
- **Cosine query** (`services/retrieval.ts`):
  - Operator: `<=>` (pgvector cosine distance)
  - Similarity: `1 - (embedding <=> query_vector::vector)`
  - Filter: `similarity > 0.3`
  - Order: similarity DESC
  - Limit: 5
  - Bot scope: `WHERE tenant_bot_id = $botId`

---

## Migrations Inventory

Migration output: `./drizzle/`, dialect `postgresql`. `bun run db:push` applies schema directly (bypasses migration files for local dev).

### `0000_unusual_cerebro.sql`

Initial baseline schema. Creates all three enums and all tables: `admin_reply_targets`, `business_connections`, `conversation_summaries`, `conversations`, `document_chunks`, `documents`, `messages`, `retrieval_events`, `tenant_bots`, `tenants`. Adds FK constraints and indexes.

Notes: this is the only entry in `_journal.json`. Several columns present in the current schema were added later via `db:push` and are NOT in this SQL file: `documents.tenant_bot_id`, `document_chunks.tenant_bot_id`, `business_connections.rights`, `business_connections.last_synced_at`, `tenant_bots.welcome_message`, `tenant_bots.auto_read_business_messages`, `admin_reply_targets.customer_label`, `admin_reply_targets.prompt_message_id`.

### `0001_admin_reply_targets.sql`

Standalone hand-written re-apply with `IF NOT EXISTS` guards. Not tracked in `_journal.json`. Idempotent.

---

## Shared Packages

### `@tg-business/db`

- **Driver**: `@neondatabase/serverless` HTTP + `drizzle-orm/neon-http`. All queries over HTTP to Neon's serverless endpoint.
- **Exports**: `db` (Drizzle client), all table objects (`tenants`, `tenantBots`, `businessConnections`, `documents`, `documentChunks`, `conversations`, `adminReplyTargets`, `messages`, `conversationSummaries`, `retrievalEvents`), all enum objects.

### `@tg-business/crypto`

- **Dependency**: Web Crypto API (`crypto.subtle`) — Bun-built-in.
- **Exports**: `encrypt(plaintext) → Promise<string>`, `decrypt(ciphertext) → Promise<string>`.
- **Algorithm**: AES-GCM.
- **Key derivation**: `ENCRYPTION_KEY` UTF-8 encoded, first 32 bytes. Falls back to SHA-256 of `BOT_TOKEN` with `console.warn` if `ENCRYPTION_KEY` is absent — insecure, must not happen in production.
- **IV**: 12 random bytes per encrypt via `crypto.getRandomValues`.
- **Storage**: base64-encoded `[IV(12) || ciphertext || GCM auth tag(16)]`. IV sliced back off at decrypt.
- **Where used**: `BotRegistry` decrypts tokens on load; RAG worker decrypts in finish step for owner notification; bot creation encrypts new tokens.

### `@tg-business/storage`

- **Dependency**: `backblaze-b2@1.7.1`.
- **Exports**: `uploadFile(bucketId, fileName, data, mime?)`, `downloadFileById(fileId)`, `deleteFile(bucketId, fileId, fileName)`, `b2BucketId()` (env helper).
- B2 client is a lazily-initialized module singleton with cached authorization.

---

## RAG Pipeline

### 1. Upload → B2 → documents row → Inngest event

Inside `documentMgmt` conversation in `apps/bot/src/bots/registry.ts`, wrapped in `conversation.external`:

1. Bot receives a document message from owner.
2. Bot downloads from `https://api.telegram.org/file/bot<token>/<file_path>`.
3. Calls `uploadFile(b2BucketId(), "tenants/<tenantId>/docs/<uuid>.<ext>", buffer, detectedMime)`.
4. POSTs to RAG worker `/ingest` with JSON:

```json
{
  "b2FileId": "<B2 file ID>",
  "b2FileName": "<B2 object path>",
  "tenantId": "<tenant UUID>",
  "botId": "<tenant_bot UUID>",
  "fileName": "<original filename>",
  "mimeType": "<detected MIME type>"
}
```

5. RAG worker (`apps/rag/src/server.ts`) inserts `documents` row with `status='processing'`, then `inngest.send` with event `"rag/document.ingest"` and payload:

```json
{
  "b2FileId": "<B2 file ID>",
  "documentId": "<documents.id UUID>",
  "tenantId": "<tenant UUID>",
  "botId": "<tenant_bot UUID>",
  "mimeType": "<MIME type>"
}
```

Returns `{ documentId, status: "queued" }` 202.

### 2. RAG worker processes the event

Inngest function `processDocument` (`id: "rag/document.ingest"`, concurrency 5, retries 3). Three sequential steps:

**extract** — `downloadFileById(b2FileId)`, dispatch by MIME:

| MIME | parser | library |
|---|---|---|
| `application/pdf` | `extractPdf` | `pdf-parse` (`PDFParse`) |
| `text/plain`, `text/markdown` | `extractPlain` | `TextDecoder` UTF-8 |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `extractDocx` | `mammoth` |
| `text/html` | `extractHtml` | regex-based stripper |

All parsers strip null bytes (`\0`). HTML parser also strips `<script>`, `<style>`, `<noscript>`, comments, all tags, decodes common HTML entities, collapses whitespace.

**process** — `splitText(text)` with `size=500`, `overlap=50`. Recursive descent through separators `["\n\n", "\n", ".", "?", "!", ",", " ", ""]`. Splits at each level; if a piece exceeds 500 chars, recurses to next separator. `""` is the final character-level fallback. Overlap pass prepends last 50 chars of previous chunk to next. Then `embedMany({ model: EMBEDDING_MODEL, values: chunks })`. Bulk-insert all `document_chunks` rows with `tenantBotId = botId`, `metadata = {}`.

**finish** — `documents.status = 'ready'`, fetch `tenants.telegramOwnerId` + `tenantBots.botTokenEncrypted`, decrypt, raw `fetch` to Telegram `sendMessage` to notify the owner. On any exception in any step: catch → set `documents.status = 'failed'` → re-throw (Inngest retries).

### 3. Retrieval at query time

`findRelevantContent(query, botId)` in `apps/bot/src/services/retrieval.ts`:

1. `embed({ model: EMBEDDING_MODEL, value: query })`.
2. Serialize as `[n1,n2,...]::vector`.
3. Query `document_chunks` filtered to `tenant_bot_id = botId AND (1 - (embedding <=> vec)) > 0.3`.
4. Order similarity DESC, limit 5.
5. Return `{ content, similarity }[]`.

---

## Per-bot vs Per-tenant Scoping (Critical)

Two load-bearing invariants from `CLAUDE.md` — violations leak data across tenants/bots.

### Conversations: scoped per `business_connection_id`

`conversations.business_connection_id` is a plain text column (the string Telegram delivers). Lookups must use this column — not `tenant_id` alone — to find/create a conversation. A tenant can have multiple bots; each bot multiple business connections; the same `telegram_chat_id` can appear under different connections without conflict.

**Bug surface**: looking up by `(tenant_id, telegram_chat_id)` would return wrong rows or create duplicates when a tenant has more than one bot serving the same customer.

### Documents and chunks: scoped per `tenant_bot_id`

Both tables carry a nullable `tenant_bot_id` FK. Retrieval (`services/retrieval.ts`) filters exclusively on `eq(documentChunks.tenantBotId, botId)`, not `tenant_id`.

**Bug surface**: any query filtering docs by `tenant_id` alone leaks one bot's knowledge base into another bot's RAG results within the same tenant.

### Where enforcement lives

| invariant | enforcement point |
|---|---|
| conversation lookup by business_connection_id | `conversations.business_connection_id` + `conversations_bc_idx` |
| retrieval filtered to bot | `eq(documentChunks.tenantBotId, botId)` in `services/retrieval.ts` |
| document listing filtered to bot | `listDocuments(botId)` via `GET /api/documents?botId=` |
| chunk insert tagged with botId | `tenantBotId: botId` in Inngest step "process" |
| documents row tagged with botId | `tenantBotId: botId` in RAG server `/ingest` handler |

---

## AI Subsystem

### Model

Configured via `AI_MODEL`. Default: `"deepseek/deepseek-v4-flash"` (`services/ai.ts:63`). Resolved through Vercel AI Gateway via `generateText`.

### System prompt construction

`askAI` receives `question`, `systemPrompt`. The `systemPrompt` comes from `tenant_bots.system_prompt` and is used verbatim — there is **no** template substitution and no global business-name variable. Owners write their actual business name directly into the prompt via the /prompt editor. The bot then appends instructions to: use conversation history, call `get_information` for questions needing document context, two-step `send_admin_message` (ask for the message text first), never falsely claim a message was sent. The grounding rule is deliberately *not* doc-only: the model may answer from facts stated directly in the owner's prompt (business name, role, scope) without retrieval, and only refuses when a question needs document context, retrieval is empty, and the answer isn't in the instructions. This avoids the failure where a bot refuses "what's your company name?" despite the name being in its own system prompt.

### Tools

**`get_information`** (always present)

- Schema: `{ query: string }`
- Embeds, runs cosine search scoped to `botId`, returns `{ found: false, message }` or `{ found: true, chunks: string }` (joined with `\n\n---\n\n`).

**`send_admin_message`** (only when `options.sendAdminMessage` is provided)

- Schema: `{ message: string, reason: string }`
- Executes injected callback. In `registry.ts`, callback writes `admin_reply_targets` row + sends owner DM with Reply button.
- Returns `{ ok: true }` or `{ ok: false, error: string }`.

### Generation parameters

- `temperature: 0.3`
- `maxOutputTokens: 500`
- `stopWhen: stepCountIs(3)` — up to 3 agentic steps.
- Last 10 history entries + current question.

### Markdown to Telegram HTML

`markdownToTelegramHtml` (`lib/markdown-to-html.ts`) uses `marked.lexer` with `gfm: true`. Token-walker emits Telegram-legal HTML:

| Markdown | Telegram HTML |
|---|---|
| `**bold**` | `<b>…</b>` |
| `*em*` | `<i>…</i>` |
| `~~del~~` | `<s>…</s>` |
| `` `code` `` | `<code>…</code>` |
| fenced block | `<pre><code class="language-X">…</code></pre>` |
| blockquote | `<blockquote>…</blockquote>` |
| link | `<a href="…">…</a>` (only `https?://`, `tg://`, `mailto:` pass `safeHref`) |
| heading | `<b>…</b>` |
| image | alt text only |
| table | pipe-separated rows as plain text |
| hr | `———` |

Raw HTML in markdown source is escaped and rendered as literal text. 3+ consecutive newlines collapsed to two.

If Telegram rejects `parse_mode: "HTML"`, the bot falls back to raw markdown text (`registry.ts:1278–1282`). If *that* also fails, owner gets a delivery-failure DM.

### Conversation history loading

`loadHistory` fetches the 20 most recent rows from `messages` for the conversation (ASC by `createdAt`, `registry.ts:1409–1418`). `askAI` slices the last 10 (`ai.ts:77`).

### Error handling on AI Gateway failures

`askAI` is `.catch`-wrapped in `registry.ts:1250–1253`. On error: log `error`, return `{ text: null }`. No reply, no customer-facing fallback message — silent failure on the customer side.

### Per-end-user daily AI reply cap

Owner-configurable per bot via the management menu ("🎯 Daily limit" button). Stored on `tenant_bots.daily_user_ai_reply_limit` (nullable int; `NULL` = unlimited up to the plan's monthly cap).

- **Counter**: `airep:{botId}:{userId}:{YYYYMMDD}` in Upstash. `INCR` happens after a successful AI generation only — transient Gateway errors don't burn the user's quota.
- **Effective cap** (`effectiveDailyAiReplyCap` in `lib/plans.ts`): `min(configured ?? planCeiling, planCeiling)` where `planCeiling = plan.maxMessagesPerPeriod` (Trial 500, Pro 5,000, Business 50,000). Lapsed → defends with the trial ceiling. Downgrading a plan auto-tightens previously-permissive caps at read time; no migration needed.
- **Behavior at cap**: customer gets the canned cap-reached reply (defaults to `DAILY_AI_CAP_REACHED_REPLY` — "we're handling lots of other customers right now — I'll get back to you tomorrow") instead of an AI-generated answer. No token spend, no owner-counter increment.
- **Owner-customizable reply**: stored on `tenant_bots.daily_cap_reached_message` (≤1024 chars). NULL falls back to the default. Reached via the "✉️ Edit busy reply" button **inside the Daily-limit editor** (nested sub-setting, not a top-level management button); "Use default" clears the override. The standalone `editCapMessage` conversation + `biz_edit_cap_message` global callback handler remain registered so any stale Cap-reply button still in a chat's history continues to work — they now route through a shared `runBusyReplyEditorScreen` helper.
- **Validation** (`validateDailyCap` in `lib/plans.ts`): owner-supplied values must be positive integers ≤ plan ceiling; UI rejects out-of-range values verbatim. Re-validated on the server side in the conversation handler — client side is never trusted.
- **Order of checks** for an incoming customer message: webhook secret → BusinessBotRights pre-flight → `customerMessageLimiter` (10/60s burst) → owner-monthly `checkQuota("message")` → per-user daily cap → AI call. The daily cap sits between owner-monthly enforcement and the AI tool so both budgets are independent.

### PostHog (product analytics)

Developer-facing telemetry layer. Optional — when `POSTHOG_PROJECT_TOKEN` is unset every call short-circuits to a no-op (dev environments stay silent).

- Wrapper: `apps/bot/src/lib/analytics.ts → track / identifyOwner / identifyCustomer / identifyBotGroup / flush`.
- Default host: `https://us.i.posthog.com`. Override with `POSTHOG_HOST`.
- All `track` calls are fire-and-forget (no `await`); the underlying `posthog-node` client batches every 10s or 100 events.
- Process shutdown handler in `index.ts` calls `flush()` (≤2s timeout) so SIGINT / SIGTERM doesn't drop in-flight events.

**Identity model**:

| Person type | distinct_id shape | Identified by |
|---|---|---|
| Owner | `owner:<telegram_user_id>` | `ownerCaptureMiddleware` after `upsertOwnerProfile` |
| Customer | `customer:<telegram_user_id>` | `business_message` handler, post-over-quota gate |

Prefixed ids prevent collision when the same Telegram user is both an owner of one bot and a customer of another. A process-local Set in `analytics.ts` short-circuits duplicate `identify` calls.

**Groups**: every per-bot event carries `groups: { bot: <botId> }`. The `bot` group is `groupIdentify`-registered once per bot at load with `{ botUsername, ownerTelegramUserId, tenantId }`.

**Event taxonomy** (high-level — see `apps/bot/src/lib/analytics.ts` callers for full list):

- `onboarding.*` — start/help opened, bot create flow (prompt shown, token submitted/invalid/succeeded/blocked), open/pause/resume/delete each bot in the manage list.
- `billing.*` — menu opened, plan picked, invoice minted, cancel tapped/confirmed (with reason), keep, resume, upgrade tapped/confirmed.
- `mgmt.*` — every management-menu surface (prompt updated, welcome updated/reset, knowledge opened, daily-limit set/removed/invalid, busy-reply updated/reset, autoread toggled, permissions opened/refreshed, analytics opened, analytics window picked).
- `customer.*` — `customer.identified` on first sighting, `customer.message.received` for every inbound, `customer.daily_first_seen` deduped via Upstash `posthog:dfs:{botId}:{userId}:{YYYYMMDD}` (NX EX 86400), `customer.message.handled` with `responseType ∈ "ai" | "busy_reply" | "over_quota" | "dropped_no_permission" | "rate_limited"`, `customer.cap_reached.busy_reply_sent` when the daily cap triggers.
- `owner_reply.*` — tapped, sent, cancelled, expired.
- `sub.*` — emitted from Inngest handlers: `sub.trial.started` (first-bot-created), `sub.trial.expired` (lapse with reason=trial_expired), `sub.started`/`renewed`/`canceled`/`lapsed`/`refunded`, `sub.notify.sent` for each owner-DM.
- `over_quota.*` — `over_quota.set` (via subscription-lapsed when bots get paused), `over_quota.customer_pinged` (when a customer messages a paused bot).
- `error.*` — `error.ai.generate_failed`, `error.business_reply.failed`, `error.webhook.bot_not_active`, `error.banned_ingress_drop`.

---

### Owner-facing analytics (📊 Analytics)

Read-only screen reachable from the tenant-bot management menu (row 4). Surfaces per-bot counters for three rolling windows.

- Helper: `apps/bot/src/lib/analytics-stats.ts → getBotStats(botId)`.
- Single SQL round-trip with `FILTER (WHERE …)` aggregates over a `messages JOIN conversations` plus a `business_connections` CTE scoped to this bot. Indexes used: `business_connections.tenant_bot_id`, `conversations.business_connection_id`, `messages.conversation_id` + `created_at` composite.
- Each bucket reports three numbers: `received` (`role='user'`), `answered` (`role='assistant'`), `customers` (`COUNT DISTINCT telegram_chat_id`). Difference between received and answered = customer messages that hit busy-reply / rate-limit / missing-permission / quota wall.
- Cached in Upstash at `stats:bot:{botId}` for 60s (`SET … EX 60`). Owner re-tap inside the window returns cached payload. Cache failures fall through transparently to the DB query.

**Data completeness**: the `business_message` handler inserts the customer's `role='user'` row right after the over-quota short-circuit, *before* the permission / rate-limit / quota / daily-cap checks. So every customer message that survives the over-quota gate is logged regardless of whether the bot replied. The matching `role='assistant'` row is still only inserted on a successful AI dispatch. Banned and over-quota owners are intentionally silenced end-to-end (no logs).

**UX**: render copy lives in `apps/bot/src/lib/text.ts → analyticsScreen({ username, today, last7d, last30d, lastMessageAt })`. Empty-state copy (`ANALYTICS_EMPTY_HINT`) renders when there has never been a customer message instead of three blocks of zeros. The screen ends with a `⬅ Back to menu` button (`biz_analytics_back`) that returns to `showManagementMenu`.

---

## RAG Retrieval

- Embedding model: `process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small"`.
- Operator: `<=>`; similarity = `1 - distance`.
- Filter: `similarity > 0.3`; order DESC; limit 5.
- Bot scope: `eq(documentChunks.tenantBotId, botId)`.

---

## REST API (`/api/*`)

Mounted at `/api` in `apps/bot/src/index.ts`. Every route passes through, in order: CORS (`MINIAPP_ORIGIN` allowlist) → per-IP `apiLimiter` → **initData auth** (sets the verified `ownerId`; rejects banned owners). The owner is always the verified Telegram user — never a request param. Bot payloads are `PublicBotResult` (no `botTokenEncrypted` / `webhookSecret`). All routes are consumed by the owner Mini App (`apps/miniapp`). See [Authorization for the REST API](#authorization-for-the-rest-api).

### `POST /api/tenants`

- Body: none (owner from initData). Returns the owner's tenant row (upsert).

### `GET /api/bots`

- Returns: array of `PublicBotResult` for the verified owner.

### `POST /api/bots`

- Body: `{ token: string }` (owner from initData).
- Returns: `PublicBotResult` (201).
- Side effects: Telegram `getMe`, upsert tenant, encrypt token, insert `tenant_bots`.

### `PATCH /api/bots/:id`

- Owner-checked (403 if not owner).
- Body: `{ status?, systemPrompt?, welcomeMessage?, autoReadBusinessMessages?, dailyUserAiReplyLimit?, dailyCapReachedMessage? }`. Updates only provided fields.

### `DELETE /api/bots/:id`

- Owner-checked. Side effects: decrypt token, Telegram `setWebhook("")`, delete `tenant_bots` (cascade).

### `GET /api/bots/:id/analytics`

- Owner-checked. Returns `BotStats` (today / 7d / 30d received·answered·customers + `lastMessageAt`) via `getBotStats` (Redis-cached 60s).

### `GET /api/bots/:id/permissions`

- Owner-checked. Returns `{ connected, isEnabled, rights, lastSyncedAt }` from the bot's `business_connections` row.

### `GET /api/owners/billing`

- Returns `{ plan, status, trialEndsAt, subscriptionRenewsAt, usage: { bots, docs, messages }, caps }` for the verified owner (`getBillingSummary`).

### `GET /api/documents?botId=<id>`

- Owner-checked. Returns array of `DocumentResult`.

### `POST /api/documents`

- Owner-checked. Multipart body `{ botId, file }`. Enforces the same quota / MIME / size / per-bot-cap checks as the bot upload path, then `ingestDocument` (B2 + RAG `/ingest`). Returns `{ documentId }` (201).

### `DELETE /api/documents/:id`

- Owner-checked. Side effects: B2 delete (warn-log on failure) + delete `documents` row.

---

## Rate Limiting (Layered)

| Layer | Limiter | Algorithm | Limit | Window | Key | Where wired |
|---|---|---|---|---|---|---|
| Per-IP `/api/*` | `apiLimiter` | Sliding | 120 | 60 s | `rl:api:{ip}` | `api/routes.ts:11–17` |
| Per-customer-per-bot AI | `customerMessageLimiter` | Sliding | 10 | 60 s | `rl:msg:{botId}:{customerUserId}` | `registry.ts:1172–1184`, before `askAI` |
| Per-bot Refresh button | `permissionRefreshLimiter` | Fixed | 1 | 3 s | `rl:perm-refresh:{botId}` | `registry.ts:883–891`, on `biz_refresh_permissions` |
| Onboarding bot per-user | `@grammyjs/ratelimiter` | In-process sliding | 20 | 60 s | `onboarding:{from.id}` | `onboarding.ts:291–298` |
| Tenant bot owner-side per-user | `@grammyjs/ratelimiter` | In-process sliding | 30 | 60 s | `bot:{botId}:{from.id}` | `registry.ts:690–697`, filtered to non-business-chat updates only |
| Per-end-user daily AI replies | `daily-ai-limit.ts` (raw INCR + EXPIRE) | Calendar-day UTC | owner-set (clamped to plan cap) | 24h | `airep:{botId}:{userId}:{YYYYMMDD}` | `registry.ts` business_message handler, after owner-quota check |

### Fail-open

`apiLimiter`, `customerMessageLimiter`, `permissionRefreshLimiter`, and the daily-AI-reply counter all fail open on Redis errors — outage allows traffic through rather than taking the service offline. The daily counter logs a warn and treats the read as 0; the INCR-on-success path is best-effort.

---

## Persistent State in Redis (Upstash)

| Key prefix | Stored by | TTL | Scope | If wiped |
|---|---|---|---|---|
| `tg:session:onboarding:{chatId}` | `UpstashSessionStorage` | none | per-user | onboarding session resets (schema is empty) |
| `tg:conv:onboarding:{chatId}` | `UpstashSessionStorage` | none | per-chat | in-flight `createBot`/`deleteBot` conversations break |
| `tg:session:bot:{botId}:{chatId}` | `UpstashSessionStorage` | none | per-bot, per-chat | session resets |
| `tg:conv:bot:{botId}:{chatId}` | `UpstashSessionStorage` | none | per-bot, per-chat | in-flight `editPrompt`/`editWelcome`/`documentMgmt` break |
| `rl:msg:{botId}:{customerUserId}` | `@upstash/ratelimit` | 60 s sliding | per-bot, per-customer | rate-limit counter resets |
| `rl:api:{ip}` | `@upstash/ratelimit` | 60 s sliding | per-IP | rate-limit counter resets |
| `rl:perm-refresh:{botId}` | `@upstash/ratelimit` | 3 s fixed | per-bot | harmless |
| `alert:perm:{botId}` | `claimPermissionAlertSlot` (`SET NX EX 1800`) | 1800 s | per-bot | owner may receive a duplicate "missing can_reply" DM sooner |
| `airep:{botId}:{userId}:{YYYYMMDD}` | `incrDailyAiReplyCount` (`INCR + EXPIRE 90000`) | ~25h | per-bot, per-end-user, per-UTC-day | per-user daily AI-reply counter resets, customer may get extra replies that day |

---

## Security Model

### Webhook secret verification

`verifyWebhookSecret(expected, actual)` in `apps/bot/src/lib/webhook-secret.ts`:

- Header: `X-Telegram-Bot-Api-Secret-Token` (`WEBHOOK_SECRET_HEADER`).
- Compares using `crypto.timingSafeEqual` after `Buffer.from`. Returns `false` if either is empty/null or lengths differ.
- **Onboarding bot** (`index.ts:20–29`): verified against `onboardingWebhookSecret` = `process.env.ONBOARDING_WEBHOOK_SECRET` if set, else fresh `randomBytes(16).toString("hex")` per process start. **In production this env var must be set** — otherwise a restart breaks the registered webhook.
- **Tenant bots** (`index.ts:40–62`): secret retrieved from `registry.getWebhookSecret(id)` → `BotEntry.webhookSecret` → `tenant_bots.webhook_secret`, stored at creation as `randomBytes(16).toString("hex")`.

### Token encryption at rest

See [`@tg-business/crypto`](#tg-businesscrypto). AES-GCM, 12-byte random IV per encrypt, base64 storage, key from `ENCRYPTION_KEY`. Insecure fallback to SHA-256(`BOT_TOKEN`) when `ENCRYPTION_KEY` is absent — **must not be allowed in production**.

### Authorization for the REST API

All `/api/*` routes require **Telegram Mini App `initData` HMAC verification** (`lib/telegram-auth.ts`, `verifyInitData`). The Mini App sends `Authorization: tma <initData>`; a Hono middleware in `routes.ts` verifies the HMAC against `BOT_TOKEN` (the onboarding bot that launches the WebApp signs the data), enforces an `auth_date` freshness window (24h), and stashes the proven Telegram user id as `c.get("ownerId")`. The verified id is the sole source of owner identity — client-supplied `userId`/`telegramOwnerId` is ignored.

Every id-scoped route additionally asserts ownership before mutating: `requireBotOwner` checks `ownerForBotId(id) === ownerId` (403 otherwise), and document routes check `ownerForDocId`. Banned owners are rejected (403) in the auth middleware. Bot responses are stripped of secrets via `toPublicBot` (`lib/api.ts`) — `botTokenEncrypted` and `webhookSecret` never leave the server.

CORS (`hono/cors`) allowlists only `MINIAPP_ORIGIN` (no `*`). The per-IP rate limit still applies underneath.

### Telegram BusinessBotRights gating

Rights loaded from `business_connections.rights` (JSON column) at registry startup, cached in `BotEntry.businessRights`. Refreshed on `business_connection` update (authoritative, from Telegram) and on owner pressing "Refresh" (`getBusinessConnection`, rate-limited 1/3s per bot).

- **`canReply`** (`can_reply`): checked before every AI call on a customer message (`registry.ts:1138`). If false, AI skipped, no reply, owner alerted (throttled by `alert:perm:{botId}` Redis key). Also gated for owner Reply forwarding (`registry.ts:1316`).
- **`canReadMessages`** (`can_read_messages`): checked before `readBusinessMessage` (`registry.ts:1192–1197`); skips the doomed API call when right is absent.

### Owner-only commands

`findByOwner(ownerTelegramId)` (`registry.ts:1420–1425`) scans in-memory `this.bots` map. Used in:
- `bot.command("start")` (`registry.ts:806`) — owner → management menu; non-owner → customer welcome.
- `bot.on("message")` (`registry.ts:1302–1303`) — same split.
- Catch-all `callback_query:data` (`registry.ts:990–998`) — owner gets management menu on stale buttons; non-owners silently acknowledged.

Owner identity is `tenants.telegram_owner_id` (Telegram numeric user ID as string), set at tenant/bot creation.

### Known gaps

- **No auth on `/api/*`** — any caller with a valid Telegram user ID can act on that user's bots.
- **`ONBOARDING_WEBHOOK_SECRET` optional in dev** — restart with unset env breaks the registered webhook.
- **Crypto key fallback** — SHA-256(`BOT_TOKEN`) is insecure; only `console.warn`ed.
- **`findByOwner` is in-memory only** — if a bot isn't loaded into the registry, the owner is treated as a stranger.
- **No per-bot global rate limit** — distributed attacker accounts could each stay under per-user caps and still overwhelm a bot's outbound Telegram budget.
- **No webhook-ingress rate limit on `/webhook/tenant/:id`** — secret leak + replay floods would hit handlers (capped after that by the grammy limiter).

---

## Environment Variables

| Variable | Required | Purpose | Typical source |
|---|---|---|---|
| `BOT_TOKEN` | Yes | Onboarding bot token | @BotFather |
| `DATABASE_URL` | Yes | Neon Postgres connection (HTTP) | Neon |
| `AI_GATEWAY_API_KEY` | Yes | AI Gateway key (chat + embeddings) | Vercel AI Gateway |
| `PUBLIC_URL` | Yes (prod) | Base URL for webhook registration | ngrok in dev, hosting URL in prod |
| `ENCRYPTION_KEY` | Yes (prod) | AES-GCM key material, ≥32 chars | Generated |
| `WORKER_URL` | Yes | RAG worker URL for POST `/ingest` | `http://localhost:3001` in dev |
| `ONBOARDING_WEBHOOK_SECRET` | Recommended | Stable secret for `/webhook/onboarding` | Generated |
| `B2_APPLICATION_KEY_ID` | Yes | B2 auth key ID | B2 dashboard |
| `B2_APPLICATION_KEY` | Yes | B2 application key | B2 dashboard |
| `B2_BUCKET_ID` | Yes | B2 bucket ID | B2 dashboard |
| `B2_BUCKET_NAME` | Yes | B2 bucket name | B2 dashboard |
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash Redis REST URL | Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash Redis REST token | Upstash |
| `EMBEDDING_MODEL` | No | AI Gateway embedding model ID. Default `openai/text-embedding-3-small` | — |
| `AI_MODEL` | No | AI Gateway chat model ID. Default `deepseek/deepseek-v4-flash` | — |
| `INNGEST_DEV` | No | `1` → Inngest dev server mode (local pipeline testing) | Local dev only |
| `RAG_PORT` | No | RAG worker port. Default 3001 | Local dev |
| `BOT_PORT` | No | Bot server port. Default 3000 | Local dev |
| `LOG_LEVEL` | No | Pino level override | Hosting env |
| `NODE_ENV` | No | `production` disables pino-pretty, sets level default to `info` | Hosting env |
| `ADMIN_TELEGRAM_USER_ID` | Recommended (prod) | Telegram user id allowed to run admin commands (`/owner`, `/refund`, `/grant_comp`, `/ban`, `/unban`). Fail-closed if unset. | Generated |

Per `CLAUDE.md`: never put real env values in tests, fixtures, or any committed file. `.env` is gitignored — keep it that way.

---

## User-facing Text Constants

All user-facing strings emitted by the onboarding bot and tenant bots live in `apps/bot/src/lib/text.ts`. This is the single source of truth for copy — tweaks to wording, future i18n, or A/B variants go through that file.

Conventions:
- `UPPER_SNAKE_CASE` exports for static strings with no variables (e.g. `BOT_NOT_FOUND`, `REPLY_CANCELLED`, `TOAST_STALE_CALLBACK`).
- `camelCase(...)` exports for messages that interpolate dynamic values (e.g. `botConnectedAlert({ username, includesPermissionWarning })`, `docTooLarge({ size, limit })`).
- Strings sent with `parse_mode: "HTML"` (escalation message, reply prompt, missing-can_reply alert, delete-bot confirmation prompt) include their `<b>` / `<code>` formatting in the literal so the parse_mode requirement is obvious from the constant.
- Customer-facing welcome text (`renderCustomerWelcome` in `bots/welcome.ts`) is its own module and was already extracted earlier; `lib/text.ts` does not duplicate it.

Button labels and short status icons (e.g. `"✅"`, `"⏸️"`, `"🔙 Back"`, `"✏️ Reply"`) intentionally stay inline next to their callback-data strings — extracting them would split a single inline-keyboard concept across two files without payoff.

When adding a new owner-facing message, define the constant in `lib/text.ts` first, then reference it from the handler. Do not inline new literal strings in the bot code.

## Logging

- **Library**: `pino` with optional `pino-pretty`.
- **Level**: `LOG_LEVEL` overrides; default `debug` outside production, `info` in production.
- **Pretty printing**: enabled when `NODE_ENV` is not `production` or `test`.
- **Redacted fields**: `req.headers.authorization`, `req.headers.cookie`, `body.token`, `body.botTokenEncrypted`, `token`, `botTokenEncrypted` → `[REDACTED]`.
- **HTTP**: `pinoLogger()` middleware (`logger.ts:24–37`) emits `request completed` at `info` per request.

Selected structured event messages:

| Message | Level | Location |
|---|---|---|
| `"bot loaded from DB"` | info | `registry.ts:610` |
| `"document queued for processing"` | info | `registry.ts:558` |
| `"document ingestion failed"` | error | `registry.ts:564` |
| `"business connection authorized"` | info | `registry.ts:1061` |
| `"business connection enabled"` | info | `registry.ts` — fires on first-connect and reconnect transitions |
| `"business connection disabled"` | info | fires on `true→false` transitions only (no longer on every `is_enabled=false` re-emit) |
| `"AI response"` | info | `ai.ts:82` |
| `"send_admin_message tool called"` | info | `ai.ts:38` |
| `"AI error"` | error | `registry.ts:1251` |
| `"customer message rate-limited (10/60s); skipping AI"` | warn | `registry.ts:1179` |
| `"skipped customer message — can_reply not granted"` | warn | `registry.ts:1159` |
| `"getBusinessConnection failed"` | warn | `registry.ts:912` |

---

## Commands (Developer Workflow)

| Command | What it does | When |
|---|---|---|
| `bun install` | Install workspace deps | Initial setup, after dep changes |
| `bun test` | Run all unit tests via Bun's built-in runner | Before commits, CI |
| `bun test apps/bot/tests/registry.test.ts` | Run a single file | Focused dev |
| `bun test -t "name"` | Filter by test name | Focused dev |
| `bun run bot` | Start bot server on :3000 | Local dev — `LOG_LEVEL=debug` for pino-pretty verbose |
| `bun run rag` | Start RAG worker on :3001 | Local dev — `INNGEST_DEV=1` for local Inngest dev server |
| `bun run db:push` | `bunx drizzle-kit push` — sync schema to Neon (no migration file) | Prototyping/dev |
| `bunx drizzle-kit generate` | Generate a versioned migration in `drizzle/` | Producing checked-in SQL |
| `bunx tsc --noEmit` | Explicit type pass | When you want a hard TS check |

There is no separate lint/typecheck script — TS is checked implicitly at runtime by Bun and `tsconfig.json` is `noEmit`.

---

## Testing

- **Framework**: Bun's built-in test runner (`bun:test`).
- **Location**: `apps/bot/tests/`, `apps/rag/tests/`.
- **Total**: 130 passing assertions across 16 files as of the rate-limit feature commit.

### Bot test inventory

| File | Covers |
|---|---|
| `admin-reply-targets.test.ts` | Token lifecycle, customerLabel, promptMessageId, clearBot, multi-admin isolation, dup-token loop guard |
| `business-rights.test.ts` | `canReply`, `canReadMessages`, `formatPermissions` trimmed to used rights |
| `business-update.test.ts` | `isBusinessChatUpdate` flags 4 business update types; regular `message`/`callback_query` are not flagged |
| `client-ip.test.ts` | X-Forwarded-For / X-Real-IP parsing |
| `crypto.test.ts` | AES-GCM round-trip + tamper detection |
| `document-limits.test.ts` | Size + count caps + formatBytes |
| `document-types.test.ts` | MIME detection from filename + content type |
| `markdown-to-html.test.ts` | All Markdown→Telegram HTML conversions, safeHref, escaping |
| `permission-alert.test.ts` | NX claim and clear |
| `registry.test.ts` | InMemoryAdminReplyTargets injection wiring |
| `sequentialize.test.ts` | Per-chat serialization (`Promise.allSettled`) |
| `session-storage.test.ts` | Upstash adapter round-trip |
| `webhook-secret.test.ts` | Header presence, length mismatch, timing-safe compare |
| `welcome.test.ts` | Custom + default welcome rendering + escape |

### RAG test inventory

| File | Covers |
|---|---|
| `chunker.test.ts` | Recursive splitter with size + overlap |
| `parsers.test.ts` | Per-format extractors (PDF, DOCX, HTML, plain) |

### Not tested (intentional)

- Integration against Neon, AI Gateway, real Inngest.
- Telegram API live calls.
- Live RAG end-to-end through B2 + Inngest cloud.

Per `CLAUDE.md`: TDD is required — write failing test first, then minimal code to pass.

---

## TypeScript Configuration Quirks

From `tsconfig.json` and `CLAUDE.md`:

- **`verbatimModuleSyntax: true`** — must use `import type { ... }` for type-only imports; mixed-style is a compile error.
- **`moduleResolution: "bundler"`** — do **not** add `.js` extensions to relative imports.
- **`strict: true`**, **`noUncheckedIndexedAccess: true`**, **`noImplicitOverride: true`** — array/object index access returns `T | undefined`; subclass overrides require explicit `override`.
- **`noEmit: true`** — TS is only used for type-checking; Bun runs the source directly.
- **`module: "Preserve"`**, **`target: "ESNext"`**, **`jsx: "react-jsx"`**, **`allowJs: true`**.

---

## Deployment Notes

- Two deployable apps, both Hono: bot on `:3000`, rag on `:3001`.
- Webhook setup: during `createBot`, the onboarding flow calls `setWebhook(PUBLIC_URL/webhook/tenant/{botId}, { drop_pending_updates: true, secret_token: webhookSecret })` on the tenant's bot instance.
- Onboarding bot webhook must also be registered (one-time, externally). Use `ONBOARDING_WEBHOOK_SECRET` in prod so the secret survives restarts.
- Inngest local dev: `INNGEST_DEV=1` plus the Inngest dev server. In prod, the RAG worker connects to Inngest cloud via the standard envs.
- No CI config detected in the repo at the time of writing.

---

## Versioning & Dependencies

From root `package.json`:

| Package | Version |
|---|---|
| Runtime: Bun | (latest; types via `@types/bun`) |
| `hono` | `^4.12.18` |
| `grammy` | `^1.42.0` |
| `@grammyjs/conversations` | `^2.1.1` |
| `@grammyjs/ratelimiter` | `^1.2.1` |
| `drizzle-orm` | `^0.45.2` |
| `drizzle-kit` (dev) | `^0.31.10` |
| `@neondatabase/serverless` | `^1.1.0` |
| `ai` (Vercel AI SDK) | `^6.0.182` |
| `@upstash/redis` | `^1.38.0` |
| `@upstash/ratelimit` | `^2.0.8` |
| `inngest` | `^4.4.0` |
| `mammoth` | `^1.12.0` |
| `marked` | `^18.0.3` |
| `pdf-parse` | `^2.4.5` |
| `pino` | `^10.3.1` |
| `pino-pretty` (dev) | `^13.1.3` |
| `backblaze-b2` | `^1.7.1` |
| `zod` | `^4.4.3` |
| `typescript` (dev) | `^5` |

Workspace packages (`workspace:*`): `@tg-business/crypto`, `@tg-business/db`, `@tg-business/storage`.

---

## Project Conventions

Per `CLAUDE.md` + `AGENTS.md`:

- **Communication style**: caveman mode active by default in chat with Claude. Code, commits, PRs, and security warnings remain normal prose.
- **TDD required**: failing test first, then minimum code to pass.
- **Never put real env values** in tests, fixtures, or any committed file. `.env` is gitignored — keep it that way.
- **Scoping invariants (load-bearing)**: conversations per business_connection, documents per bot. Don't widen these back.
- **TypeScript quirks**: see above section.
- **Bot registry injection**: `BotRegistry` accepts `AdminReplyTargets` via constructor for testability. Default is `DbAdminReplyTargets`. Tests use `InMemoryAdminReplyTargets` with shared `Map`.

---

## Subscriptions

Telegram Stars billing is now implemented. `SUBSCRIPTION.md` remains the authoritative design spec; this section is the operational quick-reference.

### Plans

| Plan | Price | Bots | Docs/bot | Messages/period |
|---|---|---|---|---|
| Trial (7d, one-shot) | 0 ⭐ | 1 | 3 | 500 (whole 7d as one bucket) |
| Pro | 500 ⭐/mo | 3 | 10 | 5,000 |
| Business | 2,000 ⭐/mo | 10 | 50 | 50,000 |

Plan config lives in `apps/bot/src/lib/plans.ts` (`PLANS` constant). `subscription_period` is locked to `2592000` (30 days, only legal value for Telegram Stars). Trial starts on first bot creation, never resets per Telegram user.

### State model

`subscription_status` enum: `trialing | active | canceled | lapsed`. No `free` value — when an owner is `lapsed` all their bots get `tenant_bots.over_quota_at = now` and stay paused until they pay.

Owners can hold multiple subscription rows at once (e.g. canceled-Pro tail + active-Business after an upgrade). `effectivePlan(owner, subs)` in `lib/plans.ts` computes the highest-tier live plan; `recomputeEffectivePlan(ownerId)` in `lib/owners.ts` writes it back to the denormalized `owners.current_plan` column on every billing event.

### New tables

| Table | Purpose |
|---|---|
| `owners` | Per-Telegram-user profile, denormalized billing state, rollup counters (`bot_count`, `doc_count`, `messages_this_period`), `trial_ends_at`, `is_banned`, `notes`. |
| `subscriptions` | One row per `telegram_payment_charge_id` (UNIQUE for idempotency). `is_complimentary` for admin-granted comps. |
| `star_payments` | Audit ledger; negative `stars_amount` for refunds; full raw `successful_payment` JSON. |
| `tenant_bots.over_quota_at` | New column. Non-null = system-paused due to plan caps (distinct from owner-paused `bot_status='paused'`). |
| `tenants.telegram_owner_id` UNIQUE | Locks 1:1 owner-tenant relationship. |

See `packages/db/src/schema.ts` for the full DDL.

### Surface

`apps/bot/src/bots/billing.ts` exports `attachBillingHandlers(bot)` and `buildBillingMenuButton(ownerId)`. Mounted on the onboarding bot at `createOnboardingBot`. Provides:

- `/billing` command + stable `💳 Billing` main-menu button (label no longer flips by subscription state — the screen behind it adapts, the button itself stays consistent).
- Plan picker with side-by-side Pro / Business invoice buttons.
- `pre_checkout_query` validation (payload format, banned, already-subscribed-same-plan, nonce dedup).
- `message:successful_payment` handler that records the ledger row and fires `subscription/started` or `subscription/renewed`.
- Cancel flow with optional reason survey (`CANCEL_REASONS`).
- Resume button for canceled-but-not-yet-lapsed subs.
- Upgrade Pro → Business via service overlap (cancel Pro auto-renew + mint Business invoice).

Plan-cap enforcement lives in:
- `apps/bot/src/bots/onboarding.ts` `createBot` conversation (bot creation gate before `getMe`).
- `apps/bot/src/bots/registry.ts` `business_message` handler (`over_quota_at` short-circuit + message counter gate around `askAI`).
- `apps/bot/src/bots/registry.ts` `documentMgmt` conversation (doc upload gate).
- `apps/bot/src/api/routes.ts` (banned-owner write block on all POST/PATCH/DELETE routes).
- `apps/bot/src/index.ts` (banned-owner webhook ingress drop on `/webhook/tenant/:id`).

### Admin commands

`apps/bot/src/bots/admin-commands.ts` exports `attachAdminCommands(bot)`. Gated by `ADMIN_TELEGRAM_USER_ID` env var.

| Command | Effect |
|---|---|
| `/owner <id_or_@username>` | Inspect owner state (plan, subs, bots, usage). |
| `/refund <chargeId>` | `refundStarPayment` + `cancelStarSubscription` + fire `subscription/refunded`. |
| `/grant_comp <ownerId> <pro\|business>` | Create complimentary subscription (year-2099 `currentPeriodEnd`, `is_complimentary=true`). |
| `/ban <ownerId>` | Flip `is_banned=true`, fire `owner/banned` (handler cancels subs + force-pauses bots). |
| `/unban <ownerId>` | Flip `is_banned=false`. No auto-resubscribe. |

### Inngest functions

All Inngest functions for the bot live under `apps/bot/src/inngest/`. Served at `/api/inngest`.

**Cron (4 functions):**

| Function | Schedule | Purpose |
|---|---|---|
| `cron-lapse-sweep` | hourly :00 | Lapse paid subs past 2-day grace; fire `subscription/lapsed` per unique owner. |
| `cron-trial-sweep` | hourly :05 | Lapse trialing owners past `trial_ends_at` with no live sub. |
| `cron-reminder-scan` | daily 10:00 UTC | Fire `notify/owner` for trial T-7d, T-1d, cancel T-3d-before-end. |
| `cron-usage-reconcile` | weekly Sun 04:00 UTC | Recompute `bot_count`, `doc_count` from base tables. Drift insurance. |

**Event-driven (10 functions):** `subscription-started`, `subscription-renewed`, `subscription-canceled`, `subscription-refunded`, `subscription-lapsed`, `owner-first-bot-created`, `owner-banned`, `bot-over-quota-message`, `bot-usage-exceeded`, `notify-owner` (single fan-out function discriminated by `kind`).

Throttle: DM-fanout functions cap at `concurrency: 10` + `throttle: 30/sec` to stay under Telegram's global outbound limit.

### New env vars

- `ADMIN_TELEGRAM_USER_ID` — Telegram user id for the admin command surface. If unset, admin commands are silently denied (fail-closed).

### New Redis key prefixes

| Prefix | TTL | Purpose |
|---|---|---|
| `invoice:{ownerId}:{plan}` | 5min | Cache invoice link to prevent double-tap double-pay. |
| `nonce-pending:{nonce}` | 10min | Marks a nonce as in-flight after pre_checkout_query approval. |
| `nonce-used:{nonce}` | 24h | Locks a nonce after successful_payment. |
| `notify:{kind}:{ownerId}:{periodOrDate}` | 30d | DM dedup for the notify/owner fan-out. |
| `over-quota-nudge:{botId}` | 24h | Throttle for the customer-pinged-paused-bot owner DM. |
| `usage-exceeded:{ownerId}:{periodStart}` | period length | Throttle for the message-cap-exceeded owner DM. |

### Idempotency keys

- `subscriptions.telegram_payment_charge_id` UNIQUE → Telegram redeliveries don't double-process.
- `subscriptions.is_complimentary` + year-2099 `currentPeriodEnd` → lapse-sweep naturally skips comp rows.
- Inngest dedup via Redis keys above for owner-facing notifications.

## Known Gaps & Future Work

- **No auth on `/api/*`** — relies entirely on per-IP rate limit.
- **No per-bot global rate limit** — distributed attackers staying under per-user caps can still overwhelm a bot's outbound budget.
- **No webhook-ingress rate limit on `/webhook/tenant/:id`** — defense in depth in case of secret leak.
- **No HNSW or IVFFlat index on `document_chunks.embedding`** — sequential scan today; will degrade with scale.
- **Crypto fallback to SHA-256(`BOT_TOKEN`)** when `ENCRYPTION_KEY` is missing — must not happen in production but only `console.warn`ed.
- **Migration drift**: several columns currently in `packages/db/src/schema.ts` were added via `bun run db:push` and are NOT reflected in `drizzle/0000_unusual_cerebro.sql`. The Phase 0 subscription tables/columns also need a versioned migration generated.
- **No integration tests** — Neon/AI Gateway/Inngest paths are exercised only manually.
- **No CI** — pre-merge checks happen locally only.
- **`findByOwner` is in-memory only** — if a bot row exists but isn't loaded, the owner is treated as a stranger.
- **AI failures are silent** — customer sees nothing if `askAI` throws.
- **GDPR / right-to-be-forgotten** is deferred — no UI flow today; handle out-of-band via DB script if requested.
- **Fiat payments** — schema is stars-only. Future fiat support requires a `currency` column on `subscriptions` + `star_payments`.
- **i18n** — `owners.language_code` is captured but only English DMs are emitted in v1.
