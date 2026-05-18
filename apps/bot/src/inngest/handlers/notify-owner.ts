/**
 * Handler for `notify/owner` — the single fan-out function that turns a
 * `{kind, ownerTelegramUserId, extras}` event into an owner DM.
 *
 * Idempotency: Redis dedup on `notify:{kind}:{ownerId}:{periodOrDate}` with
 * a 30-day TTL. The `periodOrDate` segment buckets things that should fire
 * once per period (`quota_messages_exceeded`), once per day (the rest of
 * the lifecycle DMs that should also coalesce if multiple handlers race),
 * or once per (charge / cancel-id / period) where appropriate.
 *
 * Concurrency + throttle: 10 in flight, max 30/sec — Telegram's global
 * outbound limit is ~30/sec, and lapse-sweep can spew a thousand of these
 * at once.
 *
 * See SUBSCRIPTION.md "Notifications" for the full kind matrix.
 */

import { inngest } from "../client";
import type { Events, NotifyOwnerKind } from "../events";
import { redis } from "../../lib/redis";
import { sendOwnerDm } from "./_telegram";
import {
  TRIAL_STARTED_DM,
  TRIAL_ENDING_7D_DM,
  TRIAL_ENDING_1D_DM,
  TRIAL_EXPIRED_DM,
  subscriptionStartedDM,
  subscriptionCanceledDM,
  subscriptionResumedDM,
  cancelEndingSoonDM,
  subscriptionLapsedDM,
  quotaMessagesExceededDM,
  pausedBotCustomerPingDM,
} from "../../lib/text";

const PLAN_LABELS: Record<string, string> = {
  trial: "Trial",
  pro: "Pro",
  business: "Business",
};

function planLabelFromExtras(extras: Record<string, unknown> | undefined): string {
  const raw = extras?.plan;
  if (typeof raw === "string" && raw in PLAN_LABELS) {
    return PLAN_LABELS[raw] ?? raw;
  }
  return "Plan";
}

function dateLabel(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) return "—";
  // Accept either an ISO string (preferred — what other handlers emit) or
  // already-rendered date strings. Strip trailing time for ISO.
  if (/^\d{4}-\d{2}-\d{2}/.test(input)) {
    return input.slice(0, 10);
  }
  return input;
}

/**
 * Compute the dedup-key suffix per kind so each notification has the right
 * granularity. Day-bucketed for one-shot DMs; period-bucketed for the
 * usage-exceeded path; admin summaries are once-per-ISO-instant.
 */
function dedupSuffix(
  kind: NotifyOwnerKind,
  extras: Record<string, unknown> | undefined,
): string {
  const today = new Date().toISOString().slice(0, 10);
  switch (kind) {
    case "trial_started":
    case "trial_ending_7d":
    case "trial_ending_1d":
    case "trial_expired":
      // Once total per (owner, kind) — large TTL means re-sends from a
      // bug don't double-DM the same owner months later.
      return "once";
    case "subscription_started": {
      // Per-charge: extras.renewsAt is the new period end ISO. Falls back
      // to today's date.
      const renewsAt =
        typeof extras?.renewsAt === "string" ? extras.renewsAt : today;
      return `started:${renewsAt}`;
    }
    case "subscription_canceled": {
      const endsAt =
        typeof extras?.endsAt === "string" ? extras.endsAt : today;
      return `canceled:${endsAt}`;
    }
    case "subscription_resumed":
      return `resumed:${today}`;
    case "subscription_lapsed":
      return `lapsed:${today}`;
    case "cancel_3d_before_end": {
      const endsAt =
        typeof extras?.endsAt === "string" ? extras.endsAt : today;
      return `cancel3d:${endsAt}`;
    }
    case "quota_messages_exceeded":
      // Once per UTC day — the upstream handler also throttles, this is
      // belt-and-suspenders for races.
      return `quota:${today}`;
    case "customer_msg_to_paused_bot": {
      const botId =
        typeof extras?.botId === "string" ? extras.botId : "unknown";
      return `pausedbot:${botId}:${today}`;
    }
    case "admin_event_summary":
      // Per-tick: callers should set extras.tickId so multiple summaries
      // in one day still each fire.
      return typeof extras?.tickId === "string"
        ? `summary:${extras.tickId}`
        : `summary:${new Date().toISOString()}`;
  }
}

function buildText(
  kind: NotifyOwnerKind,
  extras: Record<string, unknown> | undefined,
): string | null {
  switch (kind) {
    case "trial_started":
      return TRIAL_STARTED_DM;
    case "trial_ending_7d":
      return TRIAL_ENDING_7D_DM;
    case "trial_ending_1d":
      return TRIAL_ENDING_1D_DM;
    case "trial_expired":
      return TRIAL_EXPIRED_DM;
    case "subscription_started":
      return subscriptionStartedDM({
        planLabel: planLabelFromExtras(extras),
        renewsOn: dateLabel(extras?.renewsAt),
      });
    case "subscription_canceled":
      return subscriptionCanceledDM({
        planLabel: planLabelFromExtras(extras),
        endsOn: dateLabel(extras?.endsAt),
      });
    case "subscription_resumed":
      return subscriptionResumedDM(planLabelFromExtras(extras));
    case "subscription_lapsed":
      return subscriptionLapsedDM({
        planLabel: planLabelFromExtras(extras),
        bots: typeof extras?.bots === "number" ? extras.bots : 0,
      });
    case "cancel_3d_before_end":
      return cancelEndingSoonDM({
        planLabel: planLabelFromExtras(extras),
        endsOn: dateLabel(extras?.endsAt),
      });
    case "quota_messages_exceeded": {
      const cap =
        typeof extras?.cap === "number" && extras.cap > 0 ? extras.cap : 0;
      return quotaMessagesExceededDM(cap);
    }
    case "customer_msg_to_paused_bot": {
      const botUsername =
        typeof extras?.botUsername === "string" && extras.botUsername.length
          ? extras.botUsername
          : "your bot";
      return pausedBotCustomerPingDM(botUsername);
    }
    case "admin_event_summary": {
      // Pass-through: admin summaries are pre-formatted by the caller.
      return typeof extras?.text === "string" ? extras.text : null;
    }
  }
}

export const notifyOwner = inngest.createFunction(
  {
    id: "notify-owner",
    concurrency: { limit: 5 },
    throttle: { limit: 30, period: "1s" },
    triggers: [{ event: "notify/owner" }],
  },
  async ({ event, step }) => {
    const data = event.data as Events["notify/owner"];
    const { kind, ownerTelegramUserId, extras } = data;

    // 1. Build the dedup key. The suffix encodes per-kind granularity.
    const dedupKey = await step.run("compute-dedup-key", async () => {
      const suffix = dedupSuffix(kind, extras);
      return `notify:${kind}:${ownerTelegramUserId}:${suffix}`;
    });

    // 2. Claim the slot via SET NX. Only one handler ever sends.
    const shouldSend = await step.run("claim-dedup-slot", async () => {
      const result = await redis().set(dedupKey, "1", {
        nx: true,
        ex: 60 * 60 * 24 * 30, // 30 days
      });
      return result === "OK";
    });
    if (!shouldSend) {
      return { skipped: "dedup" as const };
    }

    // 3. Build the DM text. `null` means "unknown kind" — bail.
    const text = await step.run("build-text", async () => {
      return buildText(kind, extras);
    });
    if (text === null) {
      return { skipped: "unknown-kind" as const };
    }

    // 4. Send. All template strings use <b> tags so we always parse HTML.
    const sent = await step.run("send-dm", async () => {
      return sendOwnerDm(ownerTelegramUserId, text, { parseMode: "HTML" });
    });

    return { sent };
  },
);
