/**
 * Banned-owner lookup helpers shared between the REST API write gate and the
 * tenant webhook ingress drop. Mirrors the "Bans" section of SUBSCRIPTION.md.
 */

import { eq } from "drizzle-orm";
import { db, owners, tenantBots, tenants } from "@tg-business/db";

/**
 * True when the owner row exists and has `is_banned = true`. Missing owner
 * rows are NOT considered banned (they're just new). Fail-closed only on
 * unexpected DB errors — the caller decides whether to allow or refuse.
 */
export async function isOwnerBanned(
  telegramOwnerId: string,
): Promise<boolean> {
  const owner = await db.query.owners.findFirst({
    where: eq(owners.telegramUserId, telegramOwnerId),
    columns: { isBanned: true },
  });
  return owner?.isBanned ?? false;
}

/**
 * Resolve the telegram owner id for a given bot id by joining through
 * `tenant_bots → tenants`. Returns null when the bot row is missing.
 */
export async function ownerIdForBot(
  botId: string,
): Promise<string | null> {
  const row = await db.query.tenantBots.findFirst({
    where: eq(tenantBots.id, botId),
    columns: { tenantId: true },
  });
  if (!row) return null;
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, row.tenantId),
    columns: { telegramOwnerId: true },
  });
  return tenant?.telegramOwnerId ?? null;
}

/**
 * Convenience: is the bot's owner banned? Returns false when bot/tenant
 * rows are missing so callers don't accidentally hard-block on misroutes.
 */
export async function isBotOwnerBanned(botId: string): Promise<boolean> {
  const ownerId = await ownerIdForBot(botId);
  if (ownerId === null) return false;
  return isOwnerBanned(ownerId);
}
