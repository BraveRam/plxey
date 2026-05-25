import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  customType,
  uniqueIndex,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
});

// Default system prompt for a freshly created tenant bot. No
// `{business_name}` placeholder — there is no global business-name
// substitution; owners put their actual business name directly into
// the prompt via the /prompt editor. Exported so `createBot` can set
// it explicitly on insert rather than relying on the DB column default
// (which can drift in this push-based migration workflow).
export const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful customer support assistant. Answer questions based on the provided documentation. If you cannot find the answer in the documentation, politely say so and ask the customer to rephrase or contact support.";

export const botStatus = pgEnum("bot_status", ["active", "paused", "revoked"]);
export const docStatus = pgEnum("doc_status", [
  "processing",
  "ready",
  "failed",
]);
export const msgRole = pgEnum("msg_role", ["user", "assistant", "system"]);
export const subscriptionPlan = pgEnum("subscription_plan", [
  "trial",
  "pro",
  "business",
]);
export const subscriptionStatus = pgEnum("subscription_status", [
  "trialing",
  "active",
  "canceled",
  "lapsed",
]);

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    // Locked 1:1 with the owners table — one tenant per Telegram user.
    // See SUBSCRIPTION.md: plan caps are enforced per owner across all
    // their bots, and we assume a single tenant per owner to keep that math
    // simple.
    telegramOwnerId: text("telegram_owner_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    slugUq: uniqueIndex("tenants_slug_uq").on(t.slug),
    telegramOwnerIdUq: uniqueIndex("tenants_telegram_owner_id_uq").on(
      t.telegramOwnerId,
    ),
  }),
);

export const tenantBots = pgTable(
  "tenant_bots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    botTokenEncrypted: text("bot_token_encrypted").notNull(),
    botUsername: text("bot_username"),
    status: botStatus("status").notNull().default("active"),
    webhookSecret: text("webhook_secret").notNull(),
    systemPrompt: text("system_prompt").notNull().default(DEFAULT_SYSTEM_PROMPT),
    welcomeMessage: text("welcome_message"),
    autoReadBusinessMessages: boolean("auto_read_business_messages")
      .notNull()
      .default(true),
    connectedBusinessUserId: text("connected_business_user_id"),
    // Non-null = bot is paused due to plan-cap reasons (distinct from
    // owner-initiated `status='paused'`). Set by enforceOwnerQuota on
    // lapse, cleared on re-subscribe. See SUBSCRIPTION.md "Over-Quota
    // Reconciliation".
    overQuotaAt: timestamp("over_quota_at", { withTimezone: true }),
    // Per-user-per-day cap on AI replies. NULL = unlimited up to plan cap.
    // The effective cap at runtime is min(this, plan.maxMessagesPerPeriod).
    dailyUserAiReplyLimit: integer("daily_user_ai_reply_limit"),
    // Optional override for the canned "we're busy" reply sent to a customer
    // who has hit `dailyUserAiReplyLimit` for the day. NULL = use the
    // default `DAILY_AI_CAP_REACHED_REPLY` constant in `lib/text.ts`.
    dailyCapReachedMessage: text("daily_cap_reached_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    tenantIdx: index("tenant_bots_tenant_idx").on(t.tenantId),
    overQuotaIdx: index("tenant_bots_over_quota_idx").on(t.overQuotaAt),
  }),
);

export const businessConnections = pgTable(
  "business_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    tenantBotId: uuid("tenant_bot_id")
      .notNull()
      .references(() => tenantBots.id, { onDelete: "cascade" }),
    businessConnectionId: text("business_connection_id").notNull(),
    telegramUserId: text("telegram_user_id").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    rights: jsonb("rights").$type<Record<string, boolean | undefined>>(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    bcUq: uniqueIndex("business_connections_bc_uq").on(t.businessConnectionId),
    tenantIdx: index("business_connections_tenant_idx").on(t.tenantId),
    botIdx: index("business_connections_bot_idx").on(t.tenantBotId),
  }),
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    tenantBotId: uuid("tenant_bot_id").references(() => tenantBots.id, {
      onDelete: "cascade",
    }),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    status: docStatus("status").notNull().default("processing"),
    source: text("source").notNull().default("upload"),
    b2FileId: text("b2_file_id"),
    b2FileName: text("b2_file_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    tenantIdx: index("documents_tenant_idx").on(t.tenantId),
    botIdx: index("documents_bot_idx").on(t.tenantBotId),
  }),
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    tenantBotId: uuid("tenant_bot_id").references(() => tenantBots.id, {
      onDelete: "cascade",
    }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    docChunkUq: uniqueIndex("document_chunks_doc_chunk_uq").on(
      t.documentId,
      t.chunkIndex,
    ),
    tenantIdx: index("document_chunks_tenant_idx").on(t.tenantId),
    botIdx: index("document_chunks_bot_idx").on(t.tenantBotId),
  }),
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    businessConnectionId: text("business_connection_id").notNull(),
    telegramChatId: text("telegram_chat_id").notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    tenantIdx: index("conversations_tenant_idx").on(t.tenantId),
    bcIdx: index("conversations_bc_idx").on(t.businessConnectionId),
  }),
);

export const adminReplyTargets = pgTable(
  "admin_reply_targets",
  {
    token: text("token").primaryKey(),
    tenantBotId: uuid("tenant_bot_id")
      .notNull()
      .references(() => tenantBots.id, { onDelete: "cascade" }),
    telegramChatId: text("telegram_chat_id").notNull(),
    businessConnectionId: text("business_connection_id").notNull(),
    // Pre-rendered "👤 Name (@handle) — ID: 123" label, captured when the
    // AI escalates, so the owner-side reply prompt can quote who they're
    // replying to after we delete the original notification.
    customerLabel: text("customer_label"),
    selectedByOwnerTelegramId: text("selected_by_owner_telegram_id"),
    selectedAt: timestamp("selected_at", { withTimezone: true }),
    // Telegram message_id of the "Send your reply" prompt we showed the
    // owner after they tapped Reply. We delete it once they send their
    // reply (or it's superseded by another activation).
    promptMessageId: text("prompt_message_id"),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    botIdx: index("admin_reply_targets_bot_idx").on(t.tenantBotId),
    ownerIdx: index("admin_reply_targets_owner_idx").on(
      t.selectedByOwnerTelegramId,
      t.selectedAt,
    ),
  }),
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: msgRole("role").notNull(),
    content: text("content").notNull(),
    telegramMessageId: text("telegram_message_id"),
    tokenCount: integer("token_count"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    convIdx: index("messages_conv_idx").on(t.conversationId, t.createdAt),
    tenantIdx: index("messages_tenant_idx").on(t.tenantId),
  }),
);

export const conversationSummaries = pgTable(
  "conversation_summaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    lastMessageId: uuid("last_message_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    convUq: uniqueIndex("conversation_summaries_conv_uq").on(t.conversationId),
  }),
);

export const retrievalEvents = pgTable(
  "retrieval_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    query: text("query").notNull(),
    topK: integer("top_k").notNull(),
    hits: jsonb("hits")
      .$type<Array<{ chunkId: string; score: number }>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    tenantIdx: index("retrieval_events_tenant_idx").on(t.tenantId),
  }),
);

// ============================================================================
// Subscriptions / billing — see SUBSCRIPTION.md for the full design spec.
// ============================================================================

/**
 * One row per Telegram user (`telegram_user_id` == `tenants.telegram_owner_id`).
 * Stores identity captured opportunistically from every owner interaction,
 * denormalized billing state computed from `subscriptions`, and rollup
 * counters used by the per-owner plan-cap gates.
 */
export const owners = pgTable(
  "owners",
  {
    telegramUserId: text("telegram_user_id").primaryKey(),

    // Identity (refreshed on every owner interaction)
    firstName: text("first_name"),
    lastName: text("last_name"),
    username: text("username"),
    languageCode: text("language_code"),
    isPremium: boolean("is_premium"),

    // Billing (denormalized from `subscriptions` — recomputed on every
    // billing event via effectivePlan()). `currentPlan` is nullable when
    // status='lapsed' with no active subscriptions.
    currentPlan: subscriptionPlan("current_plan"),
    subscriptionStatus: subscriptionStatus("subscription_status")
      .notNull()
      .default("trialing"),
    subscriptionRenewsAt: timestamp("subscription_renews_at", {
      withTimezone: true,
    }),
    // Set once at first-bot-creation; one-shot, never resets. NULL until then.
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    lifetimeStarsSpent: integer("lifetime_stars_spent").notNull().default(0),

    // Rollup counters (atomic SQL on every mutation)
    botCount: integer("bot_count").notNull().default(0),
    docCount: integer("doc_count").notNull().default(0),
    messagesThisPeriod: integer("messages_this_period").notNull().default(0),
    periodStartedAt: timestamp("period_started_at", { withTimezone: true }),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    // Ops
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    notes: text("notes"),
    isBanned: boolean("is_banned").notNull().default(false),
  },
  (t) => ({
    usernameIdx: index("owners_username_idx").on(t.username),
    planStatusIdx: index("owners_plan_status_idx").on(
      t.currentPlan,
      t.subscriptionStatus,
    ),
    // Used by lapse-sweep cron
    renewsAtIdx: index("owners_renews_at_idx").on(t.subscriptionRenewsAt),
    // Used by trial-sweep cron
    trialEndsAtIdx: index("owners_trial_ends_at_idx").on(t.trialEndsAt),
  }),
);

/**
 * Telegram Stars subscription. One row per `telegram_payment_charge_id`
 * (UNIQUE — provides idempotency against Telegram re-delivering the same
 * successful_payment update).
 *
 * Owners can hold multiple rows at once: e.g. a canceled Pro tail running
 * alongside an active Business after an upgrade. Effective plan is the
 * highest tier among rows where status='active' OR (status='canceled'
 * AND currentPeriodEnd > now()).
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerTelegramUserId: text("owner_telegram_user_id")
      .notNull()
      .references(() => owners.telegramUserId, { onDelete: "cascade" }),
    plan: subscriptionPlan("plan").notNull(),
    status: subscriptionStatus("status").notNull().default("active"),
    // Synthetic value `comp:{uuid}` for complimentary rows (no real Telegram
    // charge). Real subscriptions get Telegram's payment charge id.
    telegramPaymentChargeId: text("telegram_payment_charge_id")
      .notNull()
      .unique(),
    starsPerPeriod: integer("stars_per_period").notNull(),
    currentPeriodEnd: timestamp("current_period_end", {
      withTimezone: true,
    }).notNull(),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    // Comp rows skip lapse-sweep via the year-2099 currentPeriodEnd, but
    // this flag also marks them for admin reporting / filtering.
    isComplimentary: boolean("is_complimentary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    ownerIdx: index("subscriptions_owner_idx").on(t.ownerTelegramUserId),
    endIdx: index("subscriptions_end_idx").on(t.currentPeriodEnd),
    // Used by lapse-sweep query: status='active' AND currentPeriodEnd + 2d < now()
    statusEndIdx: index("subscriptions_status_end_idx").on(
      t.status,
      t.currentPeriodEnd,
    ),
  }),
);

/**
 * Audit ledger of every Stars money movement: first-recurring payments,
 * renewals, and refunds (refunds are negative `starsAmount`). Stores the
 * full raw `successful_payment` payload for debugging and audit.
 */
export const starPayments = pgTable(
  "star_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    ownerTelegramUserId: text("owner_telegram_user_id")
      .notNull()
      .references(() => owners.telegramUserId, { onDelete: "cascade" }),
    // Negative for refunds; positive for first-recurring + renewals.
    starsAmount: integer("stars_amount").notNull(),
    isFirstRecurring: boolean("is_first_recurring").notNull().default(false),
    invoicePayload: text("invoice_payload").notNull(),
    // The canonical idempotency key from Telegram. UNIQUE so a Telegram
    // redelivery (e.g. our successful_payment handler throws because
    // inngest.send fails, Telegram retries the update) can't insert a
    // second ledger row for the same charge. Refund rows reuse the
    // refunded charge's id with a `:refund` suffix so they don't collide
    // with the original positive entry.
    telegramPaymentChargeId: text("telegram_payment_charge_id"),
    rawSuccessfulPayment: jsonb("raw_successful_payment"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    ownerIdx: index("star_payments_owner_idx").on(t.ownerTelegramUserId),
    subIdx: index("star_payments_sub_idx").on(t.subscriptionId),
    chargeIdUnique: uniqueIndex("star_payments_charge_id_unique").on(
      t.telegramPaymentChargeId,
    ),
  }),
);
