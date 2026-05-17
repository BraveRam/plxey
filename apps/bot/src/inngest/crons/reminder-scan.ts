/**
 * Daily 10:00 UTC cron: scan for owners crossing notification thresholds
 * and fire `notify/owner` events.
 *
 * Thresholds (from SUBSCRIPTION.md "Notifications"):
 *   - Trial T-7d: trialing owners whose trial_ends_at is in the (now+6d, now+7d] window.
 *   - Trial T-1d: trialing owners whose trial_ends_at is in the (now+0d, now+1d] window.
 *   - Cancel T-3d-before-end: canceled subs whose currentPeriodEnd is in the (now+2d, now+3d] window.
 *
 * Dedup is the `notify/owner` handler's responsibility (Redis
 * `notify:{kind}:{ownerId}:{periodOrDate}` with 30d TTL). This function
 * just emits events for each match; the handler decides whether to send.
 *
 * Schedule offset (`0 10 * * *`) puts the scan at 10:00 UTC — well clear
 * of the hourly sweeps at minute 0/5, and during European/US morning so
 * DMs land at a reasonable user-facing time without us needing per-tz
 * scheduling.
 */

import { and, eq, gt, lte, not, isNull } from "drizzle-orm";
import { db, owners, subscriptions } from "@tg-business/db";
import { inngest } from "../client";
import { logger } from "../../lib/logger";
import type { NotifyOwnerKind } from "../events";
import { thresholdWindow } from "./_helpers";

type ReminderMatch = {
  ownerTelegramUserId: string;
  kind: NotifyOwnerKind;
  extras?: Record<string, unknown>;
};

export const reminderScan = inngest.createFunction(
  {
    id: "cron-reminder-scan",
    concurrency: { limit: 1 },
    triggers: [{ cron: "0 10 * * *" }],
  },
  async ({ step }) => {
    const now = new Date();
    const t7 = thresholdWindow(now, 7);
    const t1 = thresholdWindow(now, 1);
    const cancel3 = thresholdWindow(now, 3);

    // 1. Trial T-7d: owners trialing, trial_ends_at in (now+6d, now+7d].
    const trial7d = await step.run("find-trial-7d", async () => {
      const rows = await db.query.owners.findMany({
        where: and(
          eq(owners.subscriptionStatus, "trialing"),
          not(isNull(owners.trialEndsAt)),
          gt(owners.trialEndsAt, t7.start),
          lte(owners.trialEndsAt, t7.end),
        ),
        columns: { telegramUserId: true },
      });
      return rows.map<ReminderMatch>((r) => ({
        ownerTelegramUserId: r.telegramUserId,
        kind: "trial_ending_7d",
      }));
    });

    // 2. Trial T-1d: owners trialing, trial_ends_at in (now+0d, now+1d].
    const trial1d = await step.run("find-trial-1d", async () => {
      const rows = await db.query.owners.findMany({
        where: and(
          eq(owners.subscriptionStatus, "trialing"),
          not(isNull(owners.trialEndsAt)),
          gt(owners.trialEndsAt, t1.start),
          lte(owners.trialEndsAt, t1.end),
        ),
        columns: { telegramUserId: true },
      });
      return rows.map<ReminderMatch>((r) => ({
        ownerTelegramUserId: r.telegramUserId,
        kind: "trial_ending_1d",
      }));
    });

    // 3. Cancel T-3d-before-end: canceled subs with currentPeriodEnd in
    //    (now+2d, now+3d]. Complimentary rows are exempt — their
    //    currentPeriodEnd is year 2099, which never falls in this window
    //    anyway, but the explicit filter keeps the intent clear.
    const cancel3d = await step.run("find-cancel-3d", async () => {
      const rows = await db.query.subscriptions.findMany({
        where: and(
          eq(subscriptions.status, "canceled"),
          eq(subscriptions.isComplimentary, false),
          gt(subscriptions.currentPeriodEnd, cancel3.start),
          lte(subscriptions.currentPeriodEnd, cancel3.end),
        ),
        columns: {
          ownerTelegramUserId: true,
          currentPeriodEnd: true,
        },
      });
      return rows.map<ReminderMatch>((r) => ({
        ownerTelegramUserId: r.ownerTelegramUserId,
        kind: "cancel_3d_before_end",
        extras: { currentPeriodEnd: r.currentPeriodEnd.toISOString() },
      }));
    });

    const all = [...trial7d, ...trial1d, ...cancel3d];
    if (all.length === 0) {
      return { matches: 0 };
    }

    await step.run("fire-notify-events", async () => {
      for (const m of all) {
        try {
          await inngest.send({
            name: "notify/owner",
            data: {
              kind: m.kind,
              ownerTelegramUserId: m.ownerTelegramUserId,
              ...(m.extras ? { extras: m.extras } : {}),
            },
          });
        } catch (err) {
          logger.warn(
            {
              err,
              ownerTelegramUserId: m.ownerTelegramUserId,
              kind: m.kind,
            },
            "reminder-scan: notify/owner send failed (fail-open)",
          );
        }
      }
    });

    return {
      matches: all.length,
      trial7d: trial7d.length,
      trial1d: trial1d.length,
      cancel3d: cancel3d.length,
    };
  },
);
