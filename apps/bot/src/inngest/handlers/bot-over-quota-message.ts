/**
 * Handler for `bot/over.quota.message` — fired by the tenant-bot customer
 * message handler when a message lands on a bot whose `over_quota_at` is
 * non-null (paused due to plan limits).
 *
 * Behavior: DM the OWNER (not the customer) at most once per 24h per bot.
 * The customer side stays silent — that's the spec.
 *
 * Throttle: Redis `over-quota-nudge:{botId}` with `SET NX EX 86400`.
 *
 * See SUBSCRIPTION.md "Lapsed-owner experience" + "Notifications" rows for
 * `customer_msg_to_paused_bot`.
 */

import { eq } from "drizzle-orm";
import { db, tenantBots, tenants } from "@tg-business/db";
import { inngest } from "../client";
import type { Events } from "../events";
import { redis } from "../../lib/redis";

export const botOverQuotaMessage = inngest.createFunction(
  {
    id: "bot-over-quota-message",
    concurrency: { limit: 5 },
    triggers: [{ event: "bot/over.quota.message" }],
  },
  async ({ event, step }) => {
    const data = event.data as Events["bot/over.quota.message"];
    const { botId } = data;

    // 1. Throttle: claim the per-bot 24h slot. If we lose the race, the
    //    owner already got nudged within the last 24h for this bot.
    const shouldNotify = await step.run("claim-throttle-slot", async () => {
      const result = await redis().set(
        `over-quota-nudge:${botId}`,
        "1",
        { nx: true, ex: 86400 },
      );
      return result === "OK";
    });
    if (!shouldNotify) {
      return { skipped: "throttled" as const };
    }

    // 2. Resolve the bot → tenant → owner. We need the owner id to DM and
    //    the bot username for the message body.
    const lookup = await step.run("resolve-owner", async () => {
      const botRow = await db.query.tenantBots.findFirst({
        where: eq(tenantBots.id, botId),
        columns: { tenantId: true, botUsername: true },
      });
      if (!botRow) return null;

      const tenantRow = await db.query.tenants.findFirst({
        where: eq(tenants.id, botRow.tenantId),
        columns: { telegramOwnerId: true },
      });
      if (!tenantRow) return null;

      return {
        ownerTelegramUserId: tenantRow.telegramOwnerId,
        botUsername: botRow.botUsername,
      };
    });

    if (!lookup) {
      return { skipped: "bot-not-found" as const };
    }

    // 3. Fire the owner nudge.
    await step.run("notify", async () => {
      await inngest.send({
        name: "notify/owner",
        data: {
          kind: "customer_msg_to_paused_bot",
          ownerTelegramUserId: lookup.ownerTelegramUserId,
          extras: {
            botId,
            botUsername: lookup.botUsername ?? "your bot",
          },
        },
      });
    });

    return { notified: true, botId };
  },
);
