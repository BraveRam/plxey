/**
 * Non-ctx Stars invoice minter.
 *
 * Extracted from `createOrReuseInvoiceLink` in `bots/billing.ts` so that
 * Inngest handlers (which have no grammy `Context`) can mint invoice links
 * directly. Calls Telegram's Bot API over raw HTTPS using `BOT_TOKEN` —
 * mirrors the pattern already in `inngest/handlers/_telegram.ts`
 * (`sendOwnerDm`, `cancelStarSubscription`, `resumeStarSubscription`).
 *
 * Cache compatibility: shares the same Redis key shape
 * (`invoice:{ownerId}:{plan}`) and same stored payload (`{nonce, link}`) as
 * `createOrReuseInvoiceLink`, so a tap from `/billing` and a pre-mint from
 * a notification flow inside the 5-minute window reuse the same link.
 *
 * Fail behavior: throws on missing env, non-2xx Telegram responses, and
 * malformed responses so callers can decide whether to fail open (notify
 * pipeline) or surface an error (interactive flow).
 */

import { redis } from "../lib/redis";
import { logger } from "../lib/logger";
import { PLANS, type PlanKey } from "../lib/plans";

/** Only valid Telegram value for Stars subscriptions. 30 days. */
export const SUBSCRIPTION_PERIOD_SECONDS = 2592000;

/** Stars subscription currency (ISO-style). */
export const STARS_CURRENCY = "XTR";

/** Cache TTL for `(ownerId, plan) → {nonce, link}`. Catches accidental
 *  double-taps inside a 5-minute window without minting a second invoice. */
export const INVOICE_CACHE_TTL_SECONDS = 5 * 60;

/** 16 hex chars = 8 bytes of randomness. Plenty for an idempotency key. */
export const NONCE_LEN = 16;

export interface MintInvoiceArgs {
  ownerId: string;
  plan: Exclude<PlanKey, "trial">;
}

/** Same cache key shape as bots/billing.ts createOrReuseInvoiceLink. */
function cacheKey(ownerId: string, plan: PlanKey): string {
  return `invoice:${ownerId}:${plan}`;
}

export function generateNonce(): string {
  const bytes = new Uint8Array(NONCE_LEN / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function planLabelFor(plan: PlanKey): string {
  switch (plan) {
    case "trial":
      return "Trial";
    case "pro":
      return "Pro";
    case "business":
      return "Business";
  }
}

/**
 * Mint (or reuse from Redis) a Stars subscription invoice link for the
 * given owner + plan. Hits Telegram's Bot API directly via fetch — no
 * grammy `Context` required.
 *
 * Cache shape and payload format are byte-identical to
 * `createOrReuseInvoiceLink` in `bots/billing.ts` so handlers and the
 * interactive `/billing` flow can share invoices.
 */
export async function mintInvoiceLink(args: MintInvoiceArgs): Promise<string> {
  const { ownerId, plan } = args;
  const token = process.env.BOT_TOKEN;
  if (!token) {
    throw new Error("BOT_TOKEN not set — cannot mint invoice link");
  }

  const key = cacheKey(ownerId, plan);
  const r = redis();

  // Reuse a recent link if one is in cache. Redis read failure is
  // non-fatal — we'll just mint a fresh link.
  try {
    const cached = await r.get<{ nonce: string; link: string }>(key);
    if (cached && typeof cached.link === "string" && cached.link.length > 0) {
      return cached.link;
    }
  } catch (err) {
    logger.warn({ err, ownerId, plan }, "invoice cache read failed");
  }

  const nonce = generateNonce();
  const payload = `sub:${ownerId}:${plan}:${nonce}`;
  const config = PLANS[plan];
  const planLabel = planLabelFor(plan);

  // Raw Telegram Bot API call. Param order matches the official spec:
  // title, description, payload, provider_token, currency, prices,
  // subscription_period.
  let link: string;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/createInvoiceLink`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${planLabel} subscription`,
          description:
            `${planLabel} plan — ${config.maxBots} bots, ` +
            `${config.maxDocsPerBot} docs/bot, ` +
            `${config.maxMessagesPerPeriod.toLocaleString()} msgs/period.`,
          payload,
          provider_token: "",
          currency: STARS_CURRENCY,
          prices: [
            { label: `${planLabel} (30 days)`, amount: config.starsPerPeriod },
          ],
          subscription_period: SUBSCRIPTION_PERIOD_SECONDS,
        }),
      },
    );
    if (!res.ok) {
      throw new Error(
        `createInvoiceLink HTTP ${res.status}: ${await res.text().catch(() => "")}`,
      );
    }
    const json = (await res.json()) as {
      ok: boolean;
      result?: string;
      description?: string;
    };
    if (!json.ok || typeof json.result !== "string" || !json.result) {
      throw new Error(
        `createInvoiceLink not ok: ${json.description ?? "no description"}`,
      );
    }
    link = json.result;
  } catch (err) {
    logger.warn({ err, ownerId, plan }, "createInvoiceLink raw HTTP failed");
    throw err;
  }

  // Cache for the next 5 minutes so a double-tap on the same DM doesn't
  // mint a second invoice. Cache write failure is non-fatal — the link
  // still works.
  try {
    await r.set(key, { nonce, link }, { ex: INVOICE_CACHE_TTL_SECONDS });
  } catch (err) {
    logger.warn({ err, ownerId, plan }, "invoice cache write failed");
  }

  return link;
}
