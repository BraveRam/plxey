/**
 * Handler for `owner/first.bot.created` — fired exactly once from
 * `startTrialOnFirstBot` in `lib/owners.ts` the first time an owner's bot
 * creation succeeds.
 *
 * Sole responsibility: send the trial-welcome DM. Trial state (`trial_ends_at`
 * + `subscription_status='trialing'`) is already written by the caller.
 *
 * See SUBSCRIPTION.md "Trial".
 */

import { inngest } from "../client";
import type { Events } from "../events";
import { ownerDistinctId, track } from "../../lib/analytics";

export const ownerFirstBotCreated = inngest.createFunction(
  {
    id: "owner-first-bot-created",
    concurrency: { limit: 5 },
    triggers: [{ event: "owner/first.bot.created" }],
  },
  async ({ event, step }) => {
    const data = event.data as Events["owner/first.bot.created"];
    const { ownerTelegramUserId } = data;

    await step.run("notify-trial-started", async () => {
      await inngest.send({
        name: "notify/owner",
        data: {
          kind: "trial_started",
          ownerTelegramUserId,
        },
      });
    });

    track(ownerDistinctId(ownerTelegramUserId), "sub.trial.started");

    return { ok: true };
  },
);
