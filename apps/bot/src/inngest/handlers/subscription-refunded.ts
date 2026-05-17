/**
 * Handler for `subscription/refunded` — fired by the `/refund` admin
 * command AFTER the webhook handler has called `refundStarPayment` and
 * `editUserStarSubscription({is_canceled: true})` on Telegram.
 *
 * Mechanics:
 *   - Mark the subscriptions row canceled + lapsed (full revoke).
 *   - Insert a negative-amount star_payments row for audit.
 *   - Fire `subscription/lapsed` so the global lapse machinery (force-pause
 *     bots, owner DM) runs uniformly.
 *
 * See SUBSCRIPTION.md "Refund".
 */

import { eq } from "drizzle-orm";
import { db, starPayments, subscriptions } from "@tg-business/db";
import { inngest } from "../client";
import type { Events } from "../events";

export const subscriptionRefunded = inngest.createFunction(
  {
    id: "subscription-refunded",
    concurrency: { limit: 10 },
    triggers: [{ event: "subscription/refunded" }],
  },
  async ({ event, step }) => {
    const data = event.data as Events["subscription/refunded"];
    const { ownerTelegramUserId, telegramPaymentChargeId } = data;

    // 1. Mark subscription canceled. We pick up the (id, starsPerPeriod) so
    //    we can emit a correctly-shaped audit row in step 2.
    const subRow = await step.run("mark-canceled", async () => {
      const rows = await db
        .update(subscriptions)
        .set({
          status: "canceled",
          canceledAt: new Date(),
        })
        .where(
          eq(
            subscriptions.telegramPaymentChargeId,
            telegramPaymentChargeId,
          ),
        )
        .returning({
          id: subscriptions.id,
          starsPerPeriod: subscriptions.starsPerPeriod,
        });
      return rows[0] ?? null;
    });

    // 2. Append a negative-amount ledger row for audit. We use
    //    `invoicePayload = "refund:{chargeId}"` as a synthetic marker since
    //    we don't have the original invoice payload here. Drift insurance
    //    over historical reconciliation queries.
    await step.run("insert-audit-row", async () => {
      const amount = subRow?.starsPerPeriod ?? 0;
      await db.insert(starPayments).values({
        subscriptionId: subRow?.id ?? null,
        ownerTelegramUserId,
        starsAmount: -amount,
        isFirstRecurring: false,
        invoicePayload: `refund:${telegramPaymentChargeId}`,
        rawSuccessfulPayment: null,
      });
    });

    // 3. Fire the universal lapse event. The /lapsed handler force-pauses
    //    bots and DMs the owner.
    await step.run("fire-lapsed", async () => {
      await inngest.send({
        name: "subscription/lapsed",
        data: { ownerTelegramUserId, reason: "refunded" },
      });
    });

    return { refunded: true, subscriptionId: subRow?.id ?? null };
  },
);
