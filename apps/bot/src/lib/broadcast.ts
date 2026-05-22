/**
 * Admin broadcast: copy one message to every (non-banned) user.
 *
 * `owners` is upserted on every interaction by the owner-capture
 * middleware, so it is the full set of people who have used the
 * onboarding bot. We use `copyMessage` so the admin can broadcast any
 * message type (text, photo, video, document, …) exactly as composed,
 * without the "forwarded from" header.
 */

import type { Api } from "grammy";
import { eq } from "drizzle-orm";
import { db, owners } from "@tg-business/db";
import { logger } from "./logger";

export interface BroadcastResult {
  total: number;
  sent: number;
  failed: number;
}

// Telegram allows ~30 messages/second to different users. Stay under it.
const PER_MESSAGE_DELAY_MS = 40;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Count of users a broadcast would reach (non-banned owners). */
export async function broadcastAudienceSize(): Promise<number> {
  const rows = await db
    .select({ id: owners.telegramUserId })
    .from(owners)
    .where(eq(owners.isBanned, false));
  return rows.length;
}

/**
 * Copy `messageId` (from `fromChatId`) to every non-banned owner.
 * Per-recipient failures (e.g. the user blocked the bot → 403) are
 * counted and skipped, never aborting the run.
 */
export async function runBroadcast(
  api: Api,
  fromChatId: number,
  messageId: number,
): Promise<BroadcastResult> {
  const rows = await db
    .select({ id: owners.telegramUserId })
    .from(owners)
    .where(eq(owners.isBanned, false));

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const chatId = Number(row.id);
    if (!Number.isFinite(chatId)) {
      failed += 1;
      continue;
    }
    try {
      await api.copyMessage(chatId, fromChatId, messageId);
      sent += 1;
    } catch (err) {
      failed += 1;
      logger.debug({ err, chatId }, "broadcast: copyMessage failed (skipped)");
    }
    await sleep(PER_MESSAGE_DELAY_MS);
  }

  logger.info({ total: rows.length, sent, failed }, "broadcast complete");
  return { total: rows.length, sent, failed };
}
