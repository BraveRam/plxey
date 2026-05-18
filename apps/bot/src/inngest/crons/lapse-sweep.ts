/**
 * Hourly cron: lapse paid subscriptions whose grace period has passed.
 *
 * From SUBSCRIPTION.md "Lapse & Grace":
 *   A paid subscription transitions to `lapsed` when
 *   `status='active' AND currentPeriodEnd + 2 days < now()` with no new
 *   `successful_payment`. Complimentary rows are exempt — their
 *   `currentPeriodEnd` is set to year 2099 and the row carries
 *   `is_complimentary = true`.
 *
 * This function only flips the subscription row status and fires
 * `subscription/lapsed` per affected owner. The lifecycle handler
 * (Phase 3b — `subscription/lapsed`) is responsible for recomputing the
 * owner's effective plan, applying `over_quota_at` to all bots, and DMing.
 *
 * Fail-open: any error in a `step.run` is logged and the function relies on
 * Inngest's retry behavior. A failed mark-lapsed step retries; a failed
 * per-owner event emit is caught locally so one bad owner doesn't kill the
 * sweep.
 */

import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db, subscriptions } from "@tg-business/db";
import { inngest } from "../client";
import { logger } from "../../lib/logger";

export const lapseSweep = inngest.createFunction(
  {
    id: "cron-lapse-sweep",
    // Serialize sweeps. A long-running sweep should never overlap with the
    // next hourly tick.
    concurrency: { limit: 1 },
    triggers: [{ cron: "0 * * * *" }],
  },
  async ({ step }) => {
    // Two distinct lapse paths:
    //   1. status='active' past 2d grace — renewal failed silently.
    //   2. status='canceled' past currentPeriodEnd — owner explicitly
    //      opted out, no grace because they chose to end it.
    // is_complimentary rows skip both (year-2099 currentPeriodEnd
    // makes them invisible anyway, but the explicit filter is belt-
    // and-suspenders).
    const expired = await step.run("find-expired", async () => {
      return db.query.subscriptions.findMany({
        where: and(
          eq(subscriptions.isComplimentary, false),
          or(
            and(
              eq(subscriptions.status, "active"),
              lt(
                sql`${subscriptions.currentPeriodEnd} + interval '2 days'`,
                sql`now()`,
              ),
            ),
            and(
              eq(subscriptions.status, "canceled"),
              lt(subscriptions.currentPeriodEnd, sql`now()`),
            ),
          ),
        ),
        columns: { id: true, ownerTelegramUserId: true },
      });
    });

    if (expired.length === 0) {
      return { lapsed: 0, owners: 0 };
    }

    await step.run("mark-lapsed", async () => {
      const ids = expired.map((e) => e.id);
      await db
        .update(subscriptions)
        .set({ status: "lapsed" })
        .where(inArray(subscriptions.id, ids));
    });

    // Dedup by ownerTelegramUserId — an owner with multiple lapsed subs in
    // one tick only needs one /lapsed event since the handler recomputes the
    // effective plan from scratch.
    const ownerIds = Array.from(
      new Set(expired.map((e) => e.ownerTelegramUserId)),
    );

    await step.run("fire-lapsed-events", async () => {
      for (const ownerTelegramUserId of ownerIds) {
        try {
          await inngest.send({
            name: "subscription/lapsed",
            data: {
              ownerTelegramUserId,
              reason: "renewal_failed",
            },
          });
        } catch (err) {
          // Per-owner fail-open: log and continue so one bad event doesn't
          // kill the rest of the batch.
          logger.warn(
            { err, ownerTelegramUserId },
            "lapse-sweep: subscription/lapsed send failed (fail-open)",
          );
        }
      }
    });

    return { lapsed: expired.length, owners: ownerIds.length };
  },
);
