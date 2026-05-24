/**
 * Daily 10:00 UTC cron: scan for owners crossing notification thresholds
 * and fire `notify/owner` events.
 *
 * Thresholds (from SUBSCRIPTION.md "Notifications"):
 *   - Trial T-3d: trialing owners whose trial_ends_at is in the (now+2d, now+3d] window.
 *   - Trial T-1d: trialing owners whose trial_ends_at is in the (now+0d, now+1d] window.
 *   - Cancel T-3d-before-end: canceled subs whose currentPeriodEnd is in the (now+2d, now+3d] window.
 *   - Recovery T+3: lapsed owners whose lapse anchor is in the (now-3d, now-2d] window.
 *   - Recovery T+14: lapsed owners whose lapse anchor is in the (now-14d, now-13d] window.
 *
 * Lapse anchor = MAX(currentPeriodEnd) over the owner's lapsed/canceled
 * subscriptions, falling back to `trialEndsAt` when the owner never paid.
 * There is no `lapsed_at` column on owners — see SUBSCRIPTION.md "Lapse &
 * Grace" for why we derive it instead.
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

import { and, eq, gt, inArray, lte, not, isNull, sql } from "drizzle-orm";
import { db, owners, subscriptions } from "@tg-business/db";
import { inngest } from "../client";
import { logger } from "../../lib/logger";
import type { NotifyOwnerKind } from "../events";
import { thresholdWindow } from "./_helpers";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Returns the half-open window `(now - days, now - (days - 1)]` — i.e. the
 * 24-hour band a value must fall into to count as "T+`days`d ago" on a
 * daily scan. Mirrors `thresholdWindow` but anchored in the past.
 *
 * Exported for unit testing only — production callers should stay inside
 * the reminder-scan function.
 */
export function postLapseWindow(
  now: Date,
  days: number,
): { start: Date; end: Date } {
  const nowMs = now.getTime();
  return {
    start: new Date(nowMs - days * MS_PER_DAY),
    end: new Date(nowMs - (days - 1) * MS_PER_DAY),
  };
}

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
    const t3 = thresholdWindow(now, 3);
    const t1 = thresholdWindow(now, 1);
    const cancel3 = thresholdWindow(now, 3);

    // 1. Trial T-3d: owners trialing, trial_ends_at in (now+2d, now+3d].
    const trial3d = await step.run("find-trial-3d", async () => {
      const rows = await db.query.owners.findMany({
        where: and(
          eq(owners.subscriptionStatus, "trialing"),
          not(isNull(owners.trialEndsAt)),
          gt(owners.trialEndsAt, t3.start),
          lte(owners.trialEndsAt, t3.end),
        ),
        columns: { telegramUserId: true },
      });
      return rows.map<ReminderMatch>((r) => ({
        ownerTelegramUserId: r.telegramUserId,
        kind: "trial_ending_3d",
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

    // 4. Recovery T+3 / T+14: lapsed owners with a lapse anchor in the
    //    matching past-day window. Lapse anchor = MAX(currentPeriodEnd) over
    //    the owner's lapsed/canceled subscriptions; falls back to trialEndsAt
    //    when no subs exist (trial-only owners who never paid).
    const recovery = await step.run("find-recovery", async () => {
      const t3w = postLapseWindow(now, 3);
      const t14w = postLapseWindow(now, 14);
      const earliestNeeded = t14w.start;

      const lapsedOwners = await db.query.owners.findMany({
        where: eq(owners.subscriptionStatus, "lapsed"),
        columns: {
          telegramUserId: true,
          trialEndsAt: true,
          docCount: true,
        },
      });
      if (lapsedOwners.length === 0) return [];

      const ownerIds = lapsedOwners.map((o) => o.telegramUserId);

      // Pull MAX(currentPeriodEnd) per owner across canceled/lapsed subs.
      // Drizzle's group-by helper isn't ergonomic for this — drop to raw
      // SQL via the underlying client. Only return values >= earliest
      // window so we don't load history older than 14 days.
      const subAnchors = await db
        .select({
          ownerTelegramUserId: subscriptions.ownerTelegramUserId,
          anchor: sql<Date>`MAX(${subscriptions.currentPeriodEnd})`.as("anchor"),
        })
        .from(subscriptions)
        .where(
          and(
            inArray(subscriptions.ownerTelegramUserId, ownerIds),
            inArray(subscriptions.status, ["canceled", "lapsed"]),
            eq(subscriptions.isComplimentary, false),
          ),
        )
        .groupBy(subscriptions.ownerTelegramUserId);

      const anchorByOwner = new Map<string, Date>();
      for (const row of subAnchors) {
        if (row.anchor) anchorByOwner.set(row.ownerTelegramUserId, row.anchor);
      }

      const matches: ReminderMatch[] = [];
      for (const o of lapsedOwners) {
        const anchor =
          anchorByOwner.get(o.telegramUserId) ?? o.trialEndsAt ?? null;
        if (!anchor) continue;
        if (anchor.getTime() < earliestNeeded.getTime()) continue;
        const ms = anchor.getTime();
        const anchorIso = anchor.toISOString();
        const docs = typeof o.docCount === "number" ? o.docCount : 0;
        if (ms > t3w.start.getTime() && ms <= t3w.end.getTime()) {
          matches.push({
            ownerTelegramUserId: o.telegramUserId,
            kind: "recovery_t3",
            extras: { lapsedAt: anchorIso, docs },
          });
        }
        if (ms > t14w.start.getTime() && ms <= t14w.end.getTime()) {
          matches.push({
            ownerTelegramUserId: o.telegramUserId,
            kind: "recovery_t14",
            extras: { lapsedAt: anchorIso, docs },
          });
        }
      }
      return matches;
    });

    const all = [...trial3d, ...trial1d, ...cancel3d, ...recovery];
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
      trial3d: trial3d.length,
      trial1d: trial1d.length,
      cancel3d: cancel3d.length,
      recovery: recovery.length,
    };
  },
);
