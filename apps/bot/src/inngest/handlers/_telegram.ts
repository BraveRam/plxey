/**
 * Minimal Telegram Bot API helpers used by Inngest handlers.
 *
 * The grammy `Bot` instance lives inside the Hono server in
 * `apps/bot/src/index.ts`; Inngest handlers run in their own context and do
 * not have access to it. To DM an owner — or to call
 * `editUserStarSubscription` outside of a grammy update flow — we hit the
 * raw Telegram HTTP API using the onboarding bot's token (`BOT_TOKEN`).
 *
 * Fail-open philosophy: missing env, non-2xx responses, and thrown fetches
 * are all logged + suppressed. A failed owner DM should never poison the
 * billing pipeline.
 */

import { logger } from "../../lib/logger";

interface SendOptions {
  parseMode?: "HTML";
  replyMarkup?: unknown;
}

/**
 * Send a DM from the onboarding bot to an owner. Returns `true` on a 2xx
 * Telegram response, `false` on any failure (env missing, network, !ok).
 */
export async function sendOwnerDm(
  ownerTelegramUserId: string,
  text: string,
  opts?: SendOptions,
): Promise<boolean> {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    logger.error("BOT_TOKEN missing — cannot DM owner");
    return false;
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: ownerTelegramUserId,
          text,
          parse_mode: opts?.parseMode,
          reply_markup: opts?.replyMarkup,
        }),
      },
    );
    if (!res.ok) {
      logger.warn(
        { status: res.status, ownerTelegramUserId },
        "owner DM failed",
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err, ownerTelegramUserId }, "owner DM threw");
    return false;
  }
}

/**
 * Toggle auto-renew on a Stars subscription via Bot API.
 *
 * Per Bot API: POST `/bot{TOKEN}/editUserStarSubscription` with
 * `{ user_id, telegram_payment_charge_id, is_canceled }`.
 *
 * Fail-open: returns `false` on any failure. Callers should log + continue
 * so a single bad charge doesn't block the rest of an admin ban flow.
 */
async function setStarSubscriptionCanceled(
  args: {
    ownerTelegramUserId: string;
    telegramPaymentChargeId: string;
  },
  isCanceled: boolean,
): Promise<boolean> {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    logger.error(
      "BOT_TOKEN missing — cannot toggle star subscription auto-renew",
    );
    return false;
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/editUserStarSubscription`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: Number(args.ownerTelegramUserId),
          telegram_payment_charge_id: args.telegramPaymentChargeId,
          is_canceled: isCanceled,
        }),
      },
    );
    if (!res.ok) {
      logger.warn(
        {
          status: res.status,
          ownerTelegramUserId: args.ownerTelegramUserId,
          telegramPaymentChargeId: args.telegramPaymentChargeId,
          isCanceled,
        },
        "editUserStarSubscription failed",
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(
      {
        err,
        ownerTelegramUserId: args.ownerTelegramUserId,
        telegramPaymentChargeId: args.telegramPaymentChargeId,
        isCanceled,
      },
      "editUserStarSubscription threw",
    );
    return false;
  }
}

/**
 * Cancel auto-renew on a Stars subscription.
 *
 * Service continues until `currentPeriodEnd`. Used by the Cancel button,
 * upgrade flow (Pro → Business), admin ban + refund flows.
 */
export async function cancelStarSubscription(args: {
  ownerTelegramUserId: string;
  telegramPaymentChargeId: string;
}): Promise<boolean> {
  return setStarSubscriptionCanceled(args, true);
}

/**
 * Resume auto-renew on a previously-canceled Stars subscription. Mirrors
 * {@link cancelStarSubscription} with `is_canceled=false`. Used by the
 * Resume button when an owner undoes a cancel before `currentPeriodEnd`.
 */
export async function resumeStarSubscription(args: {
  ownerTelegramUserId: string;
  telegramPaymentChargeId: string;
}): Promise<boolean> {
  return setStarSubscriptionCanceled(args, false);
}
