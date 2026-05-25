-- Hand-rolled delta migration.
--
-- Production applies schema via `bun run db:push` (see CLAUDE.md), so the
-- meta journal does NOT track this file. Kept here purely as documentation
-- of the schema change shipped alongside the successful_payment idempotency
-- fix in apps/bot/src/bots/billing.ts.
--
-- Adds `telegram_payment_charge_id` to `star_payments` so the ledger can be
-- made idempotent against Telegram redelivering the same `successful_payment`
-- update. UNIQUE so a duplicate insert (via `ON CONFLICT DO NOTHING`) is a
-- no-op instead of an inflated audit total. Refund rows use the convention
-- `{chargeId}:refund` to keep the unique key distinct from the original
-- positive ledger entry for the same charge.

ALTER TABLE "star_payments"
  ADD COLUMN IF NOT EXISTS "telegram_payment_charge_id" text;

CREATE UNIQUE INDEX IF NOT EXISTS "star_payments_charge_id_unique"
  ON "star_payments" USING btree ("telegram_payment_charge_id");
