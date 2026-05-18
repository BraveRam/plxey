/**
 * Banned-owner lookup helpers shared between the REST API write gate and the
 * tenant webhook ingress drop. Mirrors the "Bans" section of SUBSCRIPTION.md.
 *
 * Two flavors:
 *  - `isOwnerBanned(id)` / `isBotOwnerBanned(botId)` — direct DB lookup,
 *    used by paths where freshness matters more than latency (e.g. the
 *    REST API write gate).
 *  - `isOwnerBannedCached(id)` / `loadBannedOwnersCache()` /
 *    `markOwnerBanned()` / `markOwnerUnbanned()` — in-memory Set, used
 *    by the tenant webhook ingress drop where the hot-path latency
 *    matters and admin /ban + /unban mutate the set themselves.
 */

import { eq } from "drizzle-orm";
import { db, owners, tenantBots, tenants } from "@tg-business/db";

const bannedCache = new Set<string>();
let bannedCacheLoaded = false;

/**
 * Hydrate the banned-owners Set from the DB. Call once at boot.
 * Idempotent (safe to re-call to refresh).
 */
export async function loadBannedOwnersCache(): Promise<void> {
  const rows = await db.query.owners.findMany({
    where: eq(owners.isBanned, true),
    columns: { telegramUserId: true },
  });
  bannedCache.clear();
  for (const row of rows) bannedCache.add(row.telegramUserId);
  bannedCacheLoaded = true;
}

/** True if the given owner is currently in the banned set. */
export function isOwnerBannedCached(telegramOwnerId: string): boolean {
  return bannedCache.has(telegramOwnerId);
}

/** Admin /ban handler hook. Adds the owner to the cache. */
export function markOwnerBanned(telegramOwnerId: string): void {
  bannedCache.add(telegramOwnerId);
}

/** Admin /unban handler hook. Removes the owner from the cache. */
export function markOwnerUnbanned(telegramOwnerId: string): void {
  bannedCache.delete(telegramOwnerId);
}

/** Test/diagnostic helper — exposes load state without touching the cache. */
export function isBannedOwnersCacheLoaded(): boolean {
  return bannedCacheLoaded;
}

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
