/**
 * Handler for `owner/banned` — fired by the `/ban` admin command.
 *
 * Steps (all idempotent / fail-open):
 *   1. Find all the owner's currently-active, non-comp subscriptions.
 *   2. For each, call `editUserStarSubscription({is_canceled: true})` on
 *      Telegram so renewals stop. Comp rows are skipped — they have no
 *      real Telegram charge id.
 *   3. Fire `subscription/lapsed` (reason="banned") so the global
 *      force-pause-and-DM machinery runs.
 *
 * Note: `owners.is_banned = true` is set by the admin command handler
 * BEFORE this event fires (Phase 4c). This handler does not flip that flag.
 *
 * See SUBSCRIPTION.md "Bans".
 */

import { and, eq } from "drizzle-orm";
import { db, subscriptions } from "@tg-business/db";
import { inngest } from "../client";
import type { Events } from "../events";
import { cancelStarSubscription } from "./_telegram";
import { logger } from "../../lib/logger";

export const ownerBanned = inngest.createFunction(
  {
    id: "owner-banned",
    concurrency: { limit: 5 },
    triggers: [{ event: "owner/banned" }],
  },
  async ({ event, step }) => {
    const data = event.data as Events["owner/banned"];
    const { ownerTelegramUserId } = data;

    // 1. Find all active, non-comp subs for this owner.
    const activeSubs = await step.run("find-active-subs", async () => {
      return db.query.subscriptions.findMany({
        where: and(
          eq(subscriptions.ownerTelegramUserId, ownerTelegramUserId),
          eq(subscriptions.status, "active"),
          eq(subscriptions.isComplimentary, false),
        ),
        columns: {
          id: true,
          telegramPaymentChargeId: true,
        },
      });
    });

    // 2. Cancel auto-renew on each. Per-sub fail-open: log + continue.
    await step.run("cancel-telegram-subs", async () => {
      for (const sub of activeSubs) {
        const ok = await cancelStarSubscription({
          ownerTelegramUserId,
          telegramPaymentChargeId: sub.telegramPaymentChargeId,
        });
        if (!ok) {
          logger.warn(
            {
              ownerTelegramUserId,
              telegramPaymentChargeId: sub.telegramPaymentChargeId,
            },
            "owner-banned: editUserStarSubscription failed (fail-open)",
          );
        }
      }
    });

    // 3. Fire subscription/lapsed for the global force-pause + DM.
    await step.run("force-lapse", async () => {
      await inngest.send({
        name: "subscription/lapsed",
        data: { ownerTelegramUserId, reason: "banned" },
      });
    });

    return { canceledCount: activeSubs.length };
  },
);
