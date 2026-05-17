/**
 * Hourly cron: lapse trial owners whose `trial_ends_at` has passed without
 * a paid subscription.
 *
 * From SUBSCRIPTION.md "Lapse & Grace":
 *   Trial expires without payment → owner becomes `lapsed`. Trial has no
 *   grace period.
 *
 * The "no active subscriptions row" check matters because of stacking:
 * an owner who paid mid-trial already has paid subscription rows. They
 * should not be force-lapsed at trial_ends_at — `effectivePlan` already
 * promotes them off the trial. We only target owners who never paid AND
 * whose trial has ended.
 *
 * Schedule offset (`5 * * * *`) avoids overlapping with `lapse-sweep`
 * (`0 * * * *`) so the two sweeps don't both pound the DB at the same
 * minute.
 *
 * The lifecycle handler (Phase 3b — `subscription/lapsed`) is responsible
 * for recomputing the effective plan, applying `over_quota_at`, and DMing
 * the owner. This function only flips `owners.subscription_status` and
 * fires the event.
 */

import { and, eq, inArray, isNull, lt, not, or, sql } from "drizzle-orm";
import { db, owners, subscriptions } from "@tg-business/db";
import { inngest } from "../client";
import { logger } from "../../lib/logger";

export const trialSweep = inngest.createFunction(
  {
    id: "cron-trial-sweep",
    // Single-runner; serialize with itself.
    concurrency: { limit: 1 },
    triggers: [{ cron: "5 * * * *" }],
  },
  async ({ step }) => {
    const lapsedOwnerIds = await step.run("find-expired-trials", async () => {
      // Two-step: fetch trialing-expired candidates, then exclude those
      // who have any "live" subscription row (active, or canceled-with-
      // future-period-end). A canceled-with-future-period-end sub still
      // confers service — those owners are mid-cancel, not trial-only.
      const candidates = await db.query.owners.findMany({
        where: and(
          eq(owners.subscriptionStatus, "trialing"),
          not(isNull(owners.trialEndsAt)),
          lt(owners.trialEndsAt, sql`now()`),
        ),
        columns: { telegramUserId: true },
      });

      if (candidates.length === 0) return [];

      const candidateIds = candidates.map((c) => c.telegramUserId);

      // Find any "live" subs for these candidates. Live = active OR
      // (canceled AND currentPeriodEnd > now). A row in any other state
      // does not confer service.
      const liveSubs = await db.query.subscriptions.findMany({
        where: and(
          inArray(subscriptions.ownerTelegramUserId, candidateIds),
          or(
            eq(subscriptions.status, "active"),
            and(
              eq(subscriptions.status, "canceled"),
              sql`${subscriptions.currentPeriodEnd} > now()`,
            ),
          ),
        ),
        columns: { ownerTelegramUserId: true },
      });

      const paidOwnerIds = new Set(
        liveSubs.map((s) => s.ownerTelegramUserId),
      );
      return candidateIds.filter((id) => !paidOwnerIds.has(id));
    });

    if (lapsedOwnerIds.length === 0) {
      return { lapsed: 0 };
    }

    await step.run("mark-lapsed", async () => {
      await db
        .update(owners)
        .set({
          subscriptionStatus: "lapsed",
          currentPlan: null,
          updatedAt: new Date(),
        })
        .where(inArray(owners.telegramUserId, lapsedOwnerIds));
    });

    await step.run("fire-lapsed-events", async () => {
      for (const ownerTelegramUserId of lapsedOwnerIds) {
        try {
          await inngest.send({
            name: "subscription/lapsed",
            data: {
              ownerTelegramUserId,
              reason: "trial_expired",
            },
          });
        } catch (err) {
          logger.warn(
            { err, ownerTelegramUserId },
            "trial-sweep: subscription/lapsed send failed (fail-open)",
          );
        }
      }
    });

    return { lapsed: lapsedOwnerIds.length };
  },
);
