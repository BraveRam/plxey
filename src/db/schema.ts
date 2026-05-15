import {
  pgTable, uuid, text, timestamp, jsonb, boolean, integer, customType,
  uniqueIndex, index, pgEnum
} from "drizzle-orm/pg-core";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
});

export const botStatus = pgEnum("bot_status", ["active", "paused", "revoked"]);
export const docStatus = pgEnum("doc_status", ["processing", "ready", "failed"]);
export const msgRole = pgEnum("msg_role", ["user", "assistant", "system"]);

export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  telegramOwnerId: text("telegram_owner_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  slugUq: uniqueIndex("tenants_slug_uq").on(t.slug),
}));

export const tenantBots = pgTable("tenant_bots", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  botTokenEncrypted: text("bot_token_encrypted").notNull(),
  botUsername: text("bot_username"),
  status: botStatus("status").notNull().default("active"),
  webhookSecret: text("webhook_secret").notNull(),
  systemPrompt: text("system_prompt").notNull().default("You are a helpful customer support assistant for {business_name}. Answer questions based on the provided documentation. If you cannot find the answer in the documentation, politely say so and ask the customer to rephrase or contact support."),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("tenant_bots_tenant_idx").on(t.tenantId),
}));

export const businessConnections = pgTable("business_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  tenantBotId: uuid("tenant_bot_id").notNull().references(() => tenantBots.id, { onDelete: "cascade" }),
  businessConnectionId: text("business_connection_id").notNull(),
  telegramUserId: text("telegram_user_id").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  bcUq: uniqueIndex("business_connections_bc_uq").on(t.businessConnectionId),
  tenantIdx: index("business_connections_tenant_idx").on(t.tenantId),
}));

export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  status: docStatus("status").notNull().default("processing"),
  source: text("source").notNull().default("upload"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("documents_tenant_idx").on(t.tenantId),
}));

export const documentChunks = pgTable("document_chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  docChunkUq: uniqueIndex("document_chunks_doc_chunk_uq").on(t.documentId, t.chunkIndex),
  tenantIdx: index("document_chunks_tenant_idx").on(t.tenantId),
}));

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  businessConnectionId: text("business_connection_id").notNull(),
  telegramChatId: text("telegram_chat_id").notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("conversations_tenant_idx").on(t.tenantId),
  bcIdx: index("conversations_bc_idx").on(t.businessConnectionId),
}));

export const adminReplyTargets = pgTable("admin_reply_targets", {
  token: text("token").primaryKey(),
  tenantBotId: uuid("tenant_bot_id").notNull().references(() => tenantBots.id, { onDelete: "cascade" }),
  telegramChatId: text("telegram_chat_id").notNull(),
  businessConnectionId: text("business_connection_id").notNull(),
  selectedByOwnerTelegramId: text("selected_by_owner_telegram_id"),
  selectedAt: timestamp("selected_at", { withTimezone: true }),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  botIdx: index("admin_reply_targets_bot_idx").on(t.tenantBotId),
  ownerIdx: index("admin_reply_targets_owner_idx").on(t.selectedByOwnerTelegramId, t.selectedAt),
}));

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: msgRole("role").notNull(),
  content: text("content").notNull(),
  telegramMessageId: text("telegram_message_id"),
  tokenCount: integer("token_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  convIdx: index("messages_conv_idx").on(t.conversationId, t.createdAt),
  tenantIdx: index("messages_tenant_idx").on(t.tenantId),
}));

export const conversationSummaries = pgTable("conversation_summaries", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  summary: text("summary").notNull(),
  lastMessageId: uuid("last_message_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  convUq: uniqueIndex("conversation_summaries_conv_uq").on(t.conversationId),
}));

export const retrievalEvents = pgTable("retrieval_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
  query: text("query").notNull(),
  topK: integer("top_k").notNull(),
  hits: jsonb("hits").$type<Array<{ chunkId: string; score: number }>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("retrieval_events_tenant_idx").on(t.tenantId),
}));
