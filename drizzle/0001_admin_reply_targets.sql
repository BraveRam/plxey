CREATE TABLE IF NOT EXISTS "admin_reply_targets" (
  "token" text PRIMARY KEY NOT NULL,
  "tenant_bot_id" uuid NOT NULL REFERENCES "tenant_bots"("id") ON DELETE cascade,
  "telegram_chat_id" text NOT NULL,
  "business_connection_id" text NOT NULL,
  "selected_by_owner_telegram_id" text,
  "selected_at" timestamp with time zone,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "admin_reply_targets_bot_idx"
  ON "admin_reply_targets" ("tenant_bot_id");

CREATE INDEX IF NOT EXISTS "admin_reply_targets_owner_idx"
  ON "admin_reply_targets" ("selected_by_owner_telegram_id", "selected_at");
