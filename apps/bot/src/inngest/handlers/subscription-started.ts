/**
 * Handler for `subscription/started` — the first successful Stars payment
 * for a (owner, plan) pair. Fired from the `successful_payment` webhook
 * handler (Phase 4) when `is_first_recurring=true`.
 *
 * Idempotent: the UNIQUE constraint on `subscriptions.telegramPaymentChargeId`
 * combined with `onConflictDoNothing()` makes Telegram redelivery and Inngest
 * retries collide harmlessly.
 *
 * See SUBSCRIPTION.md "Subscribe Flow" + "Inngest Event Registry".
 */

import { db, subscriptions } from "@tg-business/db";
import { inngest } from "../client";
import type { Events } from "../events";
import {
  enforceOwnerQuota,
  recomputeEffectivePlan,
  resetMessageCount,
} from "../../lib/owners";

export const subscriptionStarted = inngest.createFunction(
  {
    id: "subscription-started",
    concurrency: { limit: 10 },
    triggers: [{ event: "subscription/started" }],
  },
  async ({ event, step }) => {
    const data = event.data as Events["subscription/started"];
    const {
      ownerTelegramUserId,
      plan,
      telegramPaymentChargeId,
      starsAmount,
      subscriptionExpirationDate,
    } = data;

    // 1. Insert the subscriptions row. UNIQUE on telegramPaymentChargeId
    //    provides idempotency.
    await step.run("insert-subscription", async () => {
      await db
        .insert(subscriptions)
        .values({
          ownerTelegramUserId,
          plan,
          status: "active",
          telegramPaymentChargeId,
          starsPerPeriod: starsAmount,
          currentPeriodEnd: new Date(subscriptionExpirationDate * 1000),
        })
        .onConflictDoNothing();
    });

    // 2. Recompute the owner's effective plan from owner row + all subs.
    const planResult = await step.run("recompute-plan", async () => {
      return recomputeEffectivePlan(ownerTelegramUserId);
    });

    // 3. Reset the message counter — this payment opens a new period.
    await step.run("reset-counter", async () => {
      await resetMessageCount(ownerTelegramUserId, new Date());
    });

    // 4. Reconcile bot over_quota_at flags now that the plan changed.
    await step.run("enforce-quota", async () => {
      await enforceOwnerQuota(ownerTelegramUserId);
    });

    // 5. Fan out to the owner DM via notify/owner.
    await step.run("notify", async () => {
      await inngest.send({
        name: "notify/owner",
        data: {
          kind: "subscription_started",
          ownerTelegramUserId,
          extras: {
            plan,
            renewsAt: new Date(
              subscriptionExpirationDate * 1000,
            ).toISOString(),
          },
        },
      });
    });

    return { plan: planResult.plan, status: planResult.status };
  },
);
