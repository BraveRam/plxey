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
    concurrency: { limit: 5 },
    triggers: [{ event: "subscription/refunded" }],
  },
  async ({ event, step }) => {
    const data = event.data as Events["subscription/refunded"];
    const { ownerTelegramUserId, telegramPaymentChargeId } = data;

    // 1. Mark the row lapsed AND collapse currentPeriodEnd to now(). Refund
    //    means immediate revoke — we do NOT want the canceled-with-tail
    //    semantics (which would leave the sub "live" per effectivePlan's
    //    `status='canceled' AND currentPeriodEnd > now` filter and keep the
    //    owner on the paid plan until the original currentPeriodEnd, even
    //    though they got their stars back). status='lapsed' makes the row
    //    invisible to the live filter and effectivePlan will return null,
    //    so subscription/lapsed below can do its job.
    const subRow = await step.run("mark-lapsed", async () => {
      const rows = await db
        .update(subscriptions)
        .set({
          status: "lapsed",
          canceledAt: new Date(),
          currentPeriodEnd: new Date(),
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
