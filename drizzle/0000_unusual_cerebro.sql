CREATE TYPE "public"."bot_status" AS ENUM('active', 'paused', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."doc_status" AS ENUM('processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."msg_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TABLE "admin_reply_targets" (
	"token" text PRIMARY KEY NOT NULL,
	"tenant_bot_id" uuid NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"business_connection_id" text NOT NULL,
	"selected_by_owner_telegram_id" text,
	"selected_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tenant_bot_id" uuid NOT NULL,
	"business_connection_id" text NOT NULL,
	"telegram_user_id" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"last_message_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"business_connection_id" text NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"status" "doc_status" DEFAULT 'processing' NOT NULL,
	"source" text DEFAULT 'upload' NOT NULL,
	"b2_file_id" text,
	"b2_file_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "msg_role" NOT NULL,
	"content" text NOT NULL,
	"telegram_message_id" text,
	"token_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"query" text NOT NULL,
	"top_k" integer NOT NULL,
	"hits" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_bots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bot_token_encrypted" text NOT NULL,
	"bot_username" text,
	"status" "bot_status" DEFAULT 'active' NOT NULL,
	"webhook_secret" text NOT NULL,
	"system_prompt" text DEFAULT 'You are a helpful customer support assistant for {business_name}. Answer questions based on the provided documentation. If you cannot find the answer in the documentation, politely say so and ask the customer to rephrase or contact support.' NOT NULL,
	"connected_business_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"telegram_owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_reply_targets" ADD CONSTRAINT "admin_reply_targets_tenant_bot_id_tenant_bots_id_fk" FOREIGN KEY ("tenant_bot_id") REFERENCES "public"."tenant_bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_connections" ADD CONSTRAINT "business_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_connections" ADD CONSTRAINT "business_connections_tenant_bot_id_tenant_bots_id_fk" FOREIGN KEY ("tenant_bot_id") REFERENCES "public"."tenant_bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_events" ADD CONSTRAINT "retrieval_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_events" ADD CONSTRAINT "retrieval_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_events" ADD CONSTRAINT "retrieval_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_bots" ADD CONSTRAINT "tenant_bots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_reply_targets_bot_idx" ON "admin_reply_targets" USING btree ("tenant_bot_id");--> statement-breakpoint
CREATE INDEX "admin_reply_targets_owner_idx" ON "admin_reply_targets" USING btree ("selected_by_owner_telegram_id","selected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_connections_bc_uq" ON "business_connections" USING btree ("business_connection_id");--> statement-breakpoint
CREATE INDEX "business_connections_tenant_idx" ON "business_connections" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_summaries_conv_uq" ON "conversation_summaries" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversations_tenant_idx" ON "conversations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "conversations_bc_idx" ON "conversations" USING btree ("business_connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_chunks_doc_chunk_uq" ON "document_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "document_chunks_tenant_idx" ON "document_chunks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "documents_tenant_idx" ON "documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "messages_conv_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_tenant_idx" ON "messages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "retrieval_events_tenant_idx" ON "retrieval_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_bots_tenant_idx" ON "tenant_bots" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_uq" ON "tenants" USING btree ("slug");