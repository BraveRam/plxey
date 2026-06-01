/**
 * Owner ban / unban — the shared core behind both the `/ban`+`/unban` admin
 * commands (`bots/admin-commands.ts`) and the admin dashboard API
 * (`api/routes.ts`). Keeping the mutation in one place means the two surfaces
 * can never drift on side effects (ban cache, owner/banned fan-out).
 */

import { eq } from "drizzle-orm";
import { db, owners } from "@tg-business/db";
import { markOwnerBanned, markOwnerUnbanned } from "./banned";
import { inngest } from "../inngest/client";

/**
 * Ban an owner: flag `is_banned`, update the in-memory ban cache (so the next
 * tenant webhook for this owner's bots short-circuits in O(1) without a DB
 * round-trip), then fire `owner/banned` (whose handler cancels all active
 * subscriptions + pauses all bots). Idempotent. Returns `{ found: false }`
 * when no owner row matches so the caller can 404.
 */
export async function banOwner(ownerId: string): Promise<{ found: boolean }> {
  const result = await db
    .update(owners)
    .set({ isBanned: true, updatedAt: new Date() })
    .where(eq(owners.telegramUserId, ownerId))
    .returning({ telegramUserId: owners.telegramUserId });

  if (result.length === 0) return { found: false };

  markOwnerBanned(ownerId);
  await inngest.send({
    name: "owner/banned",
    data: { ownerTelegramUserId: ownerId },
  });
  return { found: true };
}

/**
 * Unban an owner: clear `is_banned` and drop the owner from the ban cache so
 * the next webhook is no longer dropped at ingress. No auto-resubscribe — the
 * owner must subscribe again, per the locked billing design.
 */
export async function unbanOwner(ownerId: string): Promise<{ found: boolean }> {
  const result = await db
    .update(owners)
    .set({ isBanned: false, updatedAt: new Date() })
    .where(eq(owners.telegramUserId, ownerId))
    .returning({ telegramUserId: owners.telegramUserId });

  if (result.length === 0) return { found: false };

  markOwnerUnbanned(ownerId);
  return { found: true };
}
