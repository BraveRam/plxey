/**
 * Handler for `notify/owner` — the single fan-out function that turns a
 * `{kind, ownerTelegramUserId, extras}` event into an owner DM.
 *
 * Each DM ships with a per-kind inline keyboard built in `buildDmKeyboard`.
 * Callback buttons route to the existing onboarding-bot handlers in
 * `bots/billing.ts` (same `BOT_TOKEN`, same webhook). URL buttons either
 * point at a pre-minted Stars invoice (high-intent moments) or deep-link
 * into the Mini App's billing screen via `?startapp=billing`.
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
import { ownerDistinctId, track } from "../../lib/analytics";
import { logger } from "../../lib/logger";
import { mintInvoiceLink } from "../../bots/invoice-mint";
import { getOnboardingBotUsername } from "../../lib/bot-identity";
import { PLANS, type PlanKey } from "../../lib/plans";
import {
  trialStartedDM,
  trialEnding3dDM,
  trialEnding1dDM,
  trialExpiredDM,
  subscriptionStartedDM,
  subscriptionCanceledDM,
  subscriptionResumedDM,
  cancelEndingSoonDM,
  subscriptionLapsedDM,
  quotaMessagesExceededDM,
  pausedBotCustomerPingDM,
  recoveryT3DM,
  recoveryT14DM,
} from "../../lib/text";

/**
 * Callback-data constants for buttons attached to lifecycle DMs.
 *
 * These MUST stay byte-equal to the literals registered as
 * `bot.callbackQuery(CB.*)` in `apps/bot/src/bots/billing.ts`. Drift breaks
 * routing silently — Telegram delivers the callback but no handler matches.
 * Tests assert equality via `apps/bot/tests/notify-owner.test.ts`.
 */
const CB_SUBSCRIBE_PRO = "billing_subscribe_pro";
const CB_SUBSCRIBE_BUSINESS = "billing_subscribe_business";
const CB_UPGRADE_BUSINESS = "billing_upgrade_business";
const CB_RESUME = "billing_resume";

type InlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };

type InlineKeyboardMarkup = { inline_keyboard: InlineButton[][] };

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

function planFromExtras(
  extras: Record<string, unknown> | undefined,
): PlanKey | null {
  const raw = extras?.plan;
  if (raw === "pro" || raw === "business" || raw === "trial") return raw;
  return null;
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
 * Build a `t.me/<username>?startapp=billing` deep link, or null if the
 * onboarding bot's username hasn't been resolved yet. Caller treats null as
 * "skip the Mini App button" rather than failing the whole DM.
 */
function miniappBillingUrl(): string | null {
  const username = getOnboardingBotUsername();
  if (!username) return null;
  return `https://t.me/${username}?startapp=billing`;
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
    case "trial_ending_3d":
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
    case "recovery_t3": {
      const lapsedAt =
        typeof extras?.lapsedAt === "string" ? extras.lapsedAt : today;
      return `recovery3:${lapsedAt}`;
    }
    case "recovery_t14": {
      const lapsedAt =
        typeof extras?.lapsedAt === "string" ? extras.lapsedAt : today;
      return `recovery14:${lapsedAt}`;
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
      return trialStartedDM();
    case "trial_ending_3d":
      return trialEnding3dDM();
    case "trial_ending_1d":
      return trialEnding1dDM();
    case "trial_expired":
      return trialExpiredDM();
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
      return quotaMessagesExceededDM({
        cap,
        planLabel: planLabelFromExtras(extras),
      });
    }
    case "customer_msg_to_paused_bot": {
      const botUsername =
        typeof extras?.botUsername === "string" && extras.botUsername.length
          ? extras.botUsername
          : "your bot";
      return pausedBotCustomerPingDM(botUsername);
    }
    case "recovery_t3": {
      const docs =
        typeof extras?.docs === "number" && extras.docs >= 0 ? extras.docs : 0;
      return recoveryT3DM({ docs });
    }
    case "recovery_t14":
      return recoveryT14DM();
    case "admin_event_summary": {
      // Pass-through: admin summaries are pre-formatted by the caller.
      return typeof extras?.text === "string" ? extras.text : null;
    }
  }
}

/**
 * Build the inline keyboard attached to each lifecycle DM. Returning
 * `undefined` means "no keyboard" — the DM goes out as plain text. Callback
 * buttons route to the onboarding bot's existing `bot.callbackQuery(...)`
 * handlers; the DM is sent by the same bot via `_telegram.ts:sendOwnerDm`,
 * so Telegram delivers the callback to the right webhook.
 *
 * High-intent kinds (`customer_msg_to_paused_bot`) ship a URL invoice link
 * pre-minted by the caller; if minting fails we fall back to the callback
 * button so the DM is never buttonless.
 */
function buildDmKeyboard(
  kind: NotifyOwnerKind,
  extras: Record<string, unknown> | undefined,
): InlineKeyboardMarkup | undefined {
  const miniappUrl = miniappBillingUrl();

  switch (kind) {
    case "trial_started": {
      const rows: InlineButton[][] = [
        [
          { text: `⭐ Subscribe Pro · ${PLANS.pro.starsPerPeriod}⭐`, callback_data: CB_SUBSCRIBE_PRO },
        ],
        [
          { text: `⭐ Subscribe Business · ${PLANS.business.starsPerPeriod}⭐`, callback_data: CB_SUBSCRIBE_BUSINESS },
        ],
      ];
      if (miniappUrl) rows.push([{ text: "Open Mini App", url: miniappUrl }]);
      return { inline_keyboard: rows };
    }
    case "trial_ending_3d":
    case "trial_ending_1d":
    case "trial_expired":
    case "subscription_lapsed":
    case "recovery_t3":
    case "recovery_t14":
      return {
        inline_keyboard: [
          [
            { text: `⭐ Subscribe Pro · ${PLANS.pro.starsPerPeriod}⭐`, callback_data: CB_SUBSCRIBE_PRO },
          ],
          [
            { text: `⭐ Subscribe Business · ${PLANS.business.starsPerPeriod}⭐`, callback_data: CB_SUBSCRIBE_BUSINESS },
          ],
        ],
      };
    case "cancel_3d_before_end":
    case "subscription_canceled":
      return {
        inline_keyboard: [
          [{ text: "↩️ Resume subscription", callback_data: CB_RESUME }],
        ],
      };
    case "subscription_started": {
      const rows: InlineButton[][] = [];
      if (planFromExtras(extras) === "pro") {
        rows.push([
          { text: `⬆ Upgrade to Business · ${PLANS.business.starsPerPeriod}⭐`, callback_data: CB_UPGRADE_BUSINESS },
        ]);
      }
      if (miniappUrl) rows.push([{ text: "Open Mini App", url: miniappUrl }]);
      return rows.length > 0 ? { inline_keyboard: rows } : undefined;
    }
    case "subscription_resumed": {
      if (!miniappUrl) return undefined;
      return {
        inline_keyboard: [[{ text: "Open Mini App", url: miniappUrl }]],
      };
    }
    case "quota_messages_exceeded": {
      // If they're already on Business, no upgrade option exists — keep the
      // DM informational only. Otherwise offer the upgrade as a one-tap.
      const plan = planFromExtras(extras);
      if (plan === "business") return undefined;
      return {
        inline_keyboard: [
          [
            { text: `⬆ Upgrade to Business · ${PLANS.business.starsPerPeriod}⭐`, callback_data: CB_UPGRADE_BUSINESS },
          ],
        ],
      };
    }
    case "customer_msg_to_paused_bot": {
      // High-intent moment: caller may have pre-minted an invoice link and
      // attached it as `extras.invoiceUrl`. Fall back to the callback
      // button when no link is available — we still surface a one-tap
      // path, just an extra click longer.
      const invoiceUrl =
        typeof extras?.invoiceUrl === "string" && extras.invoiceUrl.length > 0
          ? extras.invoiceUrl
          : null;
      const plan = planFromExtras(extras) ?? "pro";
      const stars = PLANS[plan].starsPerPeriod;
      if (invoiceUrl) {
        return {
          inline_keyboard: [
            [{ text: `⭐ Reactivate · ${stars}⭐ ${PLAN_LABELS[plan]}`, url: invoiceUrl }],
          ],
        };
      }
      return {
        inline_keyboard: [
          [
            { text: `⭐ Subscribe Pro · ${PLANS.pro.starsPerPeriod}⭐`, callback_data: CB_SUBSCRIBE_PRO },
          ],
          [
            { text: `⭐ Subscribe Business · ${PLANS.business.starsPerPeriod}⭐`, callback_data: CB_SUBSCRIBE_BUSINESS },
          ],
        ],
      };
    }
    case "admin_event_summary":
      return undefined;
  }
}

/**
 * For `customer_msg_to_paused_bot` we try to pre-mint a Stars invoice URL
 * so the DM lands with a 1-tap pay button. Fail-open: a Redis or Telegram
 * blip falls back to the callback flow rather than poisoning the
 * notification pipeline.
 */
async function maybePremintInvoice(
  kind: NotifyOwnerKind,
  ownerTelegramUserId: string,
  extras: Record<string, unknown> | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (kind !== "customer_msg_to_paused_bot") return extras;
  // Default the lapsed-owner up-sell to Pro — cheaper entry point, higher
  // conversion than defaulting to Business.
  const plan: PlanKey = planFromExtras(extras) === "business" ? "business" : "pro";
  try {
    const link = await mintInvoiceLink({ ownerId: ownerTelegramUserId, plan });
    return { ...(extras ?? {}), plan, invoiceUrl: link };
  } catch (err) {
    logger.warn(
      { err, ownerTelegramUserId, kind, plan },
      "premint invoice for paused-bot ping failed — falling back to callback button",
    );
    return { ...(extras ?? {}), plan };
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
    const { kind, ownerTelegramUserId } = data;

    // 1. Build the dedup key. The suffix encodes per-kind granularity.
    const dedupKey = await step.run("compute-dedup-key", async () => {
      const suffix = dedupSuffix(kind, data.extras);
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

    // 3. Optionally pre-mint an invoice link for high-intent kinds. Adds
    //    extras.invoiceUrl when minting succeeds. Inngest serializes step
    //    results through JSON, so `undefined` round-trips as `null`; we
    //    coerce it back here.
    const extrasRaw = await step.run("premint-invoice", async () =>
      maybePremintInvoice(kind, ownerTelegramUserId, data.extras),
    );
    const extras = extrasRaw ?? undefined;

    // 4. Build the DM text. `null` means "unknown kind" — bail.
    const text = await step.run("build-text", async () => {
      return buildText(kind, extras);
    });
    if (text === null) {
      return { skipped: "unknown-kind" as const };
    }

    // 5. Build the per-kind keyboard. `undefined` means plain-text DM.
    const keyboard = await step.run("build-keyboard", async () => {
      return buildDmKeyboard(kind, extras);
    });

    // 6. Send. All template strings use <b> tags so we always parse HTML.
    const sent = await step.run("send-dm", async () => {
      return sendOwnerDm(ownerTelegramUserId, text, {
        parseMode: "HTML",
        replyMarkup: keyboard,
      });
    });

    track(ownerDistinctId(ownerTelegramUserId), "sub.notify.sent", { kind });

    return { sent };
  },
);

// Exported for tests so they can assert on the keyboard structure produced
// for each NotifyOwnerKind without spinning up an Inngest harness.
export const __test = {
  buildText,
  buildDmKeyboard,
  dedupSuffix,
  miniappBillingUrl,
};
