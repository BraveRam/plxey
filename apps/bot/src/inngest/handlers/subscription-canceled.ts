/**
 * Handler for `subscription/canceled` — fired by the owner-Cancel button in
 * `/billing` AFTER the webhook handler has already called
 * `editUserStarSubscription({is_canceled: true})`.
 *
 * Mechanics:
 *   - Flip subscriptions.status to 'canceled' and stamp canceled_at.
 *   - `currentPeriodEnd` stays put — service continues until that date.
 *   - Recompute the owner's effective plan (usually unchanged: canceled
 *     subs are still "live" through their currentPeriodEnd).
 *   - DM the owner with the end date via notify/owner.
 *
 * See SUBSCRIPTION.md "Cancel & Resume".
 */

import { eq } from "drizzle-orm";
import { db, subscriptions } from "@tg-business/db";
import { inngest } from "../client";
import type { Events } from "../events";
import { recomputeEffectivePlan } from "../../lib/owners";

export const subscriptionCanceled = inngest.createFunction(
  {
    id: "subscription-canceled",
    concurrency: { limit: 5 },
    triggers: [{ event: "subscription/canceled" }],
  },
  async ({ event, step }) => {
    const data = event.data as Events["subscription/canceled"];
    const { ownerTelegramUserId, telegramPaymentChargeId } = data;

    // 1. Mark canceled. Idempotent — re-running just overwrites canceled_at
    //    with a slightly later timestamp. Returned values are serialized to
    //    JSON between `step.run` calls so we pre-stringify the Date here.
    const updated = await step.run("mark-canceled", async () => {
      const rows = await db
        .update(subscriptions)
        .set({ status: "canceled", canceledAt: new Date() })
        .where(
          eq(
            subscriptions.telegramPaymentChargeId,
            telegramPaymentChargeId,
          ),
        )
        .returning({
          plan: subscriptions.plan,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
        });
      const row = rows[0];
      if (!row) return null;
      return {
        plan: row.plan,
        currentPeriodEnd: row.currentPeriodEnd.toISOString(),
      };
    });

    // 2. Recompute effective plan. Canceled-but-still-in-period subs remain
    //    "live", so the plan often won't change yet.
    const planResult = await step.run("recompute-plan", async () => {
      return recomputeEffectivePlan(ownerTelegramUserId);
    });

    // 3. DM the owner with the end date.
    await step.run("notify", async () => {
      await inngest.send({
        name: "notify/owner",
        data: {
          kind: "subscription_canceled",
          ownerTelegramUserId,
          extras: {
            plan: updated?.plan ?? null,
            endsAt: updated?.currentPeriodEnd ?? null,
          },
        },
      });
    });

    return { plan: planResult.plan, status: planResult.status };
  },
);
