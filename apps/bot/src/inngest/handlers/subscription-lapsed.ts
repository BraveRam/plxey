/**
 * Handler for `subscription/lapsed` — the terminal "everything is paused
 * now" event.
 *
 * Triggered by:
 *   - `cron/lapse.sweep`   (reason="renewal_failed")
 *   - `cron/trial.sweep`   (reason="trial_expired")
 *   - `subscription/refunded` (reason="refunded")
 *   - `owner/banned`       (reason="banned")
 *
 * Behavior:
 *   - Recompute the owner's effective plan. They may still have another
 *     live sub on a different plan; only THAT specific sub may have lapsed.
 *   - Force-reconcile quota; banned/lapsed owners get all bots paused.
 *   - DM only if the owner is now truly lapsed (recomputed plan is null).
 *     Avoids a spurious "you're lapsed" DM when one sub of two lapsed.
 *
 * See SUBSCRIPTION.md "Lapse & Grace".
 */

import { inngest } from "../client";
import type { Events } from "../events";
import {
  enforceOwnerQuota,
  recomputeEffectivePlan,
} from "../../lib/owners";

export const subscriptionLapsed = inngest.createFunction(
  {
    id: "subscription-lapsed",
    concurrency: { limit: 5 },
    // Throttle DMs so a large batch from lapse-sweep can't saturate
    // Telegram's 30-msg/sec global outbound budget.
    throttle: { limit: 30, period: "1s" },
    triggers: [{ event: "subscription/lapsed" }],
  },
  async ({ event, step }) => {
    const data = event.data as Events["subscription/lapsed"];
    const { ownerTelegramUserId, reason } = data;

    // 1. Recompute effective plan from owner + all subs. May still be live
    //    on another plan after this row lapsed.
    const planResult = await step.run("recompute-plan", async () => {
      return recomputeEffectivePlan(ownerTelegramUserId);
    });

    // 2. Force-reconcile quota. If the new effective plan is null,
    //    enforceOwnerQuota pauses everything.
    const quotaResult = await step.run("enforce-quota", async () => {
      return enforceOwnerQuota(ownerTelegramUserId);
    });

    // 3. Only DM when the owner is truly lapsed.
    if (planResult.plan === null) {
      await step.run("notify", async () => {
        const kind =
          reason === "trial_expired"
            ? "trial_expired"
            : "subscription_lapsed";
        await inngest.send({
          name: "notify/owner",
          data: {
            kind,
            ownerTelegramUserId,
            extras: {
              reason,
              bots: quotaResult.paused.length,
            },
          },
        });
      });
    }

    return {
      plan: planResult.plan,
      reason,
      paused: quotaResult.paused.length,
    };
  },
);
