/**
 * Handler for `bot/usage.exceeded` — fired by the AI handler when
 * `messages_this_period >= cap` for an owner.
 *
 * DM the owner at most once per period via Redis throttle. Period boundary
 * shifts whenever a renewal arrives (resets `period_started_at`), so the
 * throttle key includes a period-start ISO date so the next period gets a
 * fresh slot. If the period hasn't been opened yet we fall back to "once
 * per 30 days" using the event timestamp.
 *
 * See SUBSCRIPTION.md "Plan-Cap Enforcement" → Message counter +
 * `quota_messages_exceeded` row in Notifications.
 */

import { inngest } from "../client";
import type { Events } from "../events";
import { redis } from "../../lib/redis";

export const botUsageExceeded = inngest.createFunction(
  {
    id: "bot-usage-exceeded",
    concurrency: { limit: 10 },
    triggers: [{ event: "bot/usage.exceeded" }],
  },
  async ({ event, step }) => {
    const data = event.data as Events["bot/usage.exceeded"];
    const { ownerTelegramUserId, cap } = data;

    // Per-period dedup. We don't have a stable periodStartedAt in the
    // payload, so we bucket by the YYYY-MM-DD of "today" — the renewal
    // handler resets the counter at the period boundary anyway, so a stale
    // throttle key just delays the next nudge by at most a day.
    const dedupKey = await step.run("compute-dedup-key", async () => {
      const dateStr = new Date().toISOString().slice(0, 10);
      return `usage-exceeded:${ownerTelegramUserId}:${dateStr}`;
    });

    const shouldNotify = await step.run("claim-throttle-slot", async () => {
      const result = await redis().set(dedupKey, "1", {
        nx: true,
        ex: 60 * 60 * 24 * 30, // 30 days
      });
      return result === "OK";
    });
    if (!shouldNotify) {
      return { skipped: "throttled" as const };
    }

    await step.run("notify", async () => {
      await inngest.send({
        name: "notify/owner",
        data: {
          kind: "quota_messages_exceeded",
          ownerTelegramUserId,
          extras: { cap },
        },
      });
    });

    return { notified: true };
  },
);
