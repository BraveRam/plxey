/**
 * Handler for `subscription/renewed` — a recurring Stars payment fired
 * monthly (`is_recurring=true && !is_first_recurring`).
 *
 * Telegram sends its own receipt, so we do NOT DM the owner here. We just
 * advance `currentPeriodEnd`, accumulate lifetime spend, and reset the
 * message counter at the period boundary.
 *
 * See SUBSCRIPTION.md "Renewal".
 */

import { eq, sql } from "drizzle-orm";
import { db, owners, subscriptions } from "@tg-business/db";
import { inngest } from "../client";
import type { Events } from "../events";
import {
  enforceOwnerQuota,
  recomputeEffectivePlan,
  resetMessageCount,
} from "../../lib/owners";

export const subscriptionRenewed = inngest.createFunction(
  {
    id: "subscription-renewed",
    concurrency: { limit: 5 },
    triggers: [{ event: "subscription/renewed" }],
  },
  async ({ event, step }) => {
    const data = event.data as Events["subscription/renewed"];
    const {
      ownerTelegramUserId,
      telegramPaymentChargeId,
      starsAmount,
      subscriptionExpirationDate,
    } = data;

    const periodEnd = new Date(subscriptionExpirationDate * 1000);

    // 1. Update the subscription row — advance currentPeriodEnd and reaffirm
    //    status='active'. Keyed on telegramPaymentChargeId because Telegram
    //    reuses the same charge id across the recurring chain.
    await step.run("advance-subscription", async () => {
      await db
        .update(subscriptions)
        .set({
          status: "active",
          currentPeriodEnd: periodEnd,
        })
        .where(
          eq(
            subscriptions.telegramPaymentChargeId,
            telegramPaymentChargeId,
          ),
        );
    });

    // 2. Bump lifetime spend + cache the new renews-at on the owner.
    //    Atomic SQL: `lifetime_stars_spent + $amount`.
    await step.run("bump-lifetime-spend", async () => {
      await db
        .update(owners)
        .set({
          lifetimeStarsSpent: sql`${owners.lifetimeStarsSpent} + ${starsAmount}`,
          subscriptionRenewsAt: periodEnd,
          updatedAt: new Date(),
        })
        .where(eq(owners.telegramUserId, ownerTelegramUserId));
    });

    // 3. Period boundary: reset messages_this_period to 0, periodStartedAt=now.
    await step.run("reset-counter", async () => {
      await resetMessageCount(ownerTelegramUserId, new Date());
    });

    // 4. Recompute effective plan + reconcile quota in case anything drifted.
    const planResult = await step.run("recompute-plan", async () => {
      return recomputeEffectivePlan(ownerTelegramUserId);
    });

    await step.run("enforce-quota", async () => {
      await enforceOwnerQuota(ownerTelegramUserId);
    });

    // Renewal is intentionally silent — Telegram emits its own receipt.
    return { plan: planResult.plan, status: planResult.status };
  },
);
