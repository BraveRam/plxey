/**
 * Telegram Stars billing surface for the onboarding bot.
 *
 * Implements Phase 3a of SUBSCRIPTION.md:
 *   - /billing command + main-menu "billing_menu" callback render a single
 *     state-driven screen.
 *   - Subscribe Pro / Subscribe Business buttons mint Stars invoice links via
 *     `createInvoiceLink` (cached per (owner, plan) in Redis to absorb
 *     double-taps).
 *   - `pre_checkout_query` validates the invoice payload, the owner row,
 *     and the nonce; rejects on any failure.
 *   - `message:successful_payment` records a `star_payments` ledger row,
 *     locks the nonce, then fires `subscription/started` or
 *     `subscription/renewed` for downstream Inngest processing.
 *
 * Upgrade / Cancel / Resume callbacks are stubbed here — Phase 5 wires them
 * up. They are mounted so the screen's buttons always have a handler.
 *
 * This file is self-contained. The onboarding bot composes it via
 * `attachBillingHandlers(bot)` plus `buildBillingMenuButton(ownerId)` for
 * the dynamic main-menu CTA label.
 */

import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { and, eq, desc } from "drizzle-orm";
import {
  db,
  documents,
  owners,
  starPayments,
  subscriptions,
  tenantBots,
  tenants,
} from "@tg-business/db";
import { sql } from "drizzle-orm";
import { inngest } from "../inngest/client";
import type { Events } from "../inngest/events";
import { logger } from "../lib/logger";
import { PLANS, planLimits, type PlanKey } from "../lib/plans";
import { redis } from "../lib/redis";
import {
  PLAN_PICKER_HEADER,
  TOAST_INVOICE_SENT,
  billingHeader,
  billingUsageBlock,
  planPickerLine,
} from "../lib/text";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Only valid Telegram value for Stars subscriptions. 30 days. */
const SUBSCRIPTION_PERIOD_SECONDS = 2592000;

/** Stars subscription currency (ISO-style). */
const STARS_CURRENCY = "XTR";

/** Cache TTL for `(ownerId, plan) → {nonce, link}`. Catches accidental
 *  double-taps inside a 5-minute window without minting a second invoice. */
const INVOICE_CACHE_TTL_SECONDS = 5 * 60;

/** Mark a nonce as "in flight" between pre_checkout_query approval and the
 *  successful_payment update. 10 minutes is generous compared to Telegram's
 *  10-second pre-checkout window. */
const NONCE_PENDING_TTL_SECONDS = 10 * 60;

/** After a payment lands, lock the nonce for a day so repeated retries of
 *  the same `successful_payment` (or stale invoice taps) get rejected. */
const NONCE_USED_TTL_SECONDS = 24 * 60 * 60;

const NONCE_LEN = 16;

/** Deeplink for owner-side Stars management. */
const STARS_MANAGE_URL = "https://t.me/Stars";

// Callback-data IDs. Centralised so the test file and future readers can
// grep one place.
const CB = {
  menu: "billing_menu",
  subscribePro: "billing_subscribe_pro",
  subscribeBusiness: "billing_subscribe_business",
  upgradeBusiness: "billing_upgrade_business",
  cancel: "billing_cancel",
  resume: "billing_resume",
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BillingStatus = "trialing" | "active" | "canceled" | "lapsed";

interface OwnerSubRow {
  plan: PlanKey;
  status: "trialing" | "active" | "canceled" | "lapsed";
  currentPeriodEnd: Date;
  telegramPaymentChargeId: string;
}

interface BillingState {
  ownerId: string;
  status: BillingStatus;
  /** The plan label used in headers — null when fully lapsed. */
  effectivePlan: PlanKey | null;
  trialEndsAt: Date | null;
  subscriptionRenewsAt: Date | null;
  botCount: number;
  largestBotDocCount: number;
  messagesThisPeriod: number;
  subs: OwnerSubRow[];
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Mount the /billing command and all billing callback handlers, plus the
 * Stars payment-flow handlers (`pre_checkout_query` + `successful_payment`).
 *
 * Safe to call once per bot instance.
 */
export function attachBillingHandlers(bot: Bot<Context>): void {
  bot.command("billing", async (ctx) => {
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    await renderBillingScreen(ctx, String(userId));
  });

  bot.callbackQuery(CB.menu, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    await ctx.deleteMessage().catch(() => {});
    await renderBillingScreen(ctx, String(userId));
  });

  bot.callbackQuery(CB.subscribePro, async (ctx) => {
    await handleSubscribeTap(ctx, "pro");
  });

  bot.callbackQuery(CB.subscribeBusiness, async (ctx) => {
    await handleSubscribeTap(ctx, "business");
  });

  bot.callbackQuery(CB.upgradeBusiness, async (ctx) => {
    // Phase 5 owns the editUserStarSubscription cancel-Pro step. For now,
    // surface that the flow is not wired yet.
    await ctx.answerCallbackQuery({ text: "Coming soon" });
  });

  bot.callbackQuery(CB.cancel, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Coming soon" });
  });

  bot.callbackQuery(CB.resume, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Coming soon" });
  });

  bot.on("pre_checkout_query", async (ctx) => {
    await handlePreCheckoutQuery(ctx);
  });

  bot.on("message:successful_payment", async (ctx) => {
    await handleSuccessfulPayment(ctx);
  });
}

/**
 * Build the dynamic main-menu billing button label.
 *
 * Owners on trialing/lapsed see "⭐ Subscribe" (acquisition CTA), owners on
 * active/canceled see "⚙️ Plan & Billing" (management CTA). Both route to
 * the same `billing_menu` callback.
 *
 * Falls back to the trialing label on DB errors so the menu always renders.
 */
export async function buildBillingMenuButton(
  ownerTelegramUserId: string,
): Promise<{ label: string; callbackData: "billing_menu" }> {
  let status: BillingStatus = "trialing";
  try {
    const row = await db.query.owners.findFirst({
      where: eq(owners.telegramUserId, ownerTelegramUserId),
      columns: { subscriptionStatus: true },
    });
    if (row) {
      status = row.subscriptionStatus;
    }
  } catch (err) {
    logger.warn(
      { err, ownerTelegramUserId },
      "buildBillingMenuButton: owner lookup failed (defaulting to trialing)",
    );
  }

  const acquisition = status === "trialing" || status === "lapsed";
  return {
    label: acquisition ? "⭐ Subscribe" : "⚙️ Plan & Billing",
    callbackData: CB.menu,
  };
}

// ---------------------------------------------------------------------------
// Screen render
// ---------------------------------------------------------------------------

async function renderBillingScreen(
  ctx: Context,
  ownerId: string,
): Promise<void> {
  const state = await loadBillingState(ownerId);
  const body = composeBillingScreen(state);
  const kb = buildActionsKeyboard(state);
  await ctx.reply(body, {
    parse_mode: "HTML",
    reply_markup: kb,
  });
}

// Exported for tests via a non-public helper — kept module-local otherwise.
async function loadBillingState(ownerId: string): Promise<BillingState> {
  const fallback: BillingState = {
    ownerId,
    status: "lapsed",
    effectivePlan: null,
    trialEndsAt: null,
    subscriptionRenewsAt: null,
    botCount: 0,
    largestBotDocCount: 0,
    messagesThisPeriod: 0,
    subs: [],
  };

  try {
    const ownerRow = await db.query.owners.findFirst({
      where: eq(owners.telegramUserId, ownerId),
      columns: {
        currentPlan: true,
        subscriptionStatus: true,
        subscriptionRenewsAt: true,
        trialEndsAt: true,
        botCount: true,
        docCount: true,
        messagesThisPeriod: true,
      },
    });
    if (!ownerRow) return fallback;

    const subRows = await db.query.subscriptions.findMany({
      where: eq(subscriptions.ownerTelegramUserId, ownerId),
      columns: {
        plan: true,
        status: true,
        currentPeriodEnd: true,
        telegramPaymentChargeId: true,
      },
      orderBy: [desc(subscriptions.createdAt)],
    });

    // Compute "largest bot doc count" for the usage block. Pulls the max
    // document count among any of the owner's tenant's bots. Cheap query
    // since both tables are small and indexed by tenant.
    let largestBotDocCount = 0;
    try {
      const rows = await db
        .select({
          botId: documents.tenantBotId,
          count: sql<number>`count(*)::int`,
        })
        .from(documents)
        .innerJoin(tenants, eq(documents.tenantId, tenants.id))
        .innerJoin(
          tenantBots,
          and(
            eq(tenantBots.tenantId, tenants.id),
            eq(tenantBots.id, documents.tenantBotId),
          ),
        )
        .where(eq(tenants.telegramOwnerId, ownerId))
        .groupBy(documents.tenantBotId);
      for (const r of rows) {
        if (r.count > largestBotDocCount) largestBotDocCount = r.count;
      }
    } catch (err) {
      logger.warn(
        { err, ownerId },
        "loadBillingState: largest-bot-doc-count query failed",
      );
    }

    return {
      ownerId,
      status: ownerRow.subscriptionStatus,
      effectivePlan: ownerRow.currentPlan ?? null,
      trialEndsAt: ownerRow.trialEndsAt,
      subscriptionRenewsAt: ownerRow.subscriptionRenewsAt,
      botCount: ownerRow.botCount,
      largestBotDocCount,
      messagesThisPeriod: ownerRow.messagesThisPeriod,
      subs: subRows.map((s) => ({
        plan: s.plan,
        status: s.status,
        currentPeriodEnd: s.currentPeriodEnd,
        telegramPaymentChargeId: s.telegramPaymentChargeId,
      })),
    };
  } catch (err) {
    logger.warn({ err, ownerId }, "loadBillingState failed");
    return fallback;
  }
}

function composeBillingScreen(state: BillingState): string {
  // Header — plan label + status line. For trialing owners we surface days
  // left from `trial_ends_at`. For canceled subs we show the tail end date.
  const planForLabel: PlanKey = state.effectivePlan ?? "trial";
  const planLabel = planLabelFor(planForLabel);

  let header: string;
  if (state.status === "trialing") {
    const daysLeft = state.trialEndsAt
      ? Math.max(
          0,
          Math.ceil(
            (state.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
          ),
        )
      : 0;
    header = billingHeader({
      status: "trialing",
      planLabel,
      trialDaysLeft: daysLeft,
    });
  } else if (state.status === "active") {
    header = billingHeader({
      status: "active",
      planLabel,
      renewsOn: formatDate(state.subscriptionRenewsAt),
    });
  } else if (state.status === "canceled") {
    // For the "ends on" date prefer the tail period of the highest-tier
    // canceled sub.
    const tailEnd = pickCanceledTailEnd(state.subs) ?? state.subscriptionRenewsAt;
    header = billingHeader({
      status: "canceled",
      planLabel,
      endsOn: formatDate(tailEnd),
    });
  } else {
    header = billingHeader({ status: "lapsed", planLabel });
  }

  // Usage block — driven by the effective plan's caps. If lapsed/no plan,
  // fall back to trial caps as a sane baseline for the layout.
  const limits = planLimits(planForLabel);
  const usage = billingUsageBlock({
    bots: state.botCount,
    maxBots: limits.maxBots,
    docs: state.largestBotDocCount,
    maxDocs: limits.maxDocsPerBot,
    messages: state.messagesThisPeriod,
    maxMessages: limits.maxMessagesPerPeriod,
  });

  // For trialing/lapsed owners we surface a short plan picker so they can
  // jump straight to either tier without an extra tap. Active/canceled
  // surfaces stick to the management screen — buttons are below.
  if (state.status === "trialing" || state.status === "lapsed") {
    const proLine = planPickerLine({
      planLabel: planLabelFor("pro"),
      stars: PLANS.pro.starsPerPeriod,
      maxBots: PLANS.pro.maxBots,
      maxDocsPerBot: PLANS.pro.maxDocsPerBot,
      maxMessagesPerPeriod: PLANS.pro.maxMessagesPerPeriod,
    });
    const businessLine = planPickerLine({
      planLabel: planLabelFor("business"),
      stars: PLANS.business.starsPerPeriod,
      maxBots: PLANS.business.maxBots,
      maxDocsPerBot: PLANS.business.maxDocsPerBot,
      maxMessagesPerPeriod: PLANS.business.maxMessagesPerPeriod,
    });
    return `${header}\n\n${usage}\n\n${PLAN_PICKER_HEADER}\n\n${proLine}\n\n${businessLine}`;
  }

  return `${header}\n\n${usage}`;
}

function buildActionsKeyboard(state: BillingState): InlineKeyboard {
  const kb = new InlineKeyboard();
  switch (state.status) {
    case "trialing":
    case "lapsed":
      kb.text("Subscribe Pro", CB.subscribePro).row();
      kb.text("Subscribe Business", CB.subscribeBusiness).row();
      break;
    case "active":
      if (state.effectivePlan === "pro") {
        kb.text("Upgrade to Business", CB.upgradeBusiness).row();
      }
      kb.text("Cancel subscription", CB.cancel).row();
      kb.url("Manage Stars in Telegram", STARS_MANAGE_URL).row();
      break;
    case "canceled":
      kb.text("Resume subscription", CB.resume).row();
      kb.url("Manage Stars in Telegram", STARS_MANAGE_URL).row();
      break;
  }
  return kb;
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

function pickCanceledTailEnd(subs: ReadonlyArray<OwnerSubRow>): Date | null {
  const now = Date.now();
  const tails = subs
    .filter(
      (s) => s.status === "canceled" && s.currentPeriodEnd.getTime() > now,
    )
    .map((s) => s.currentPeriodEnd);
  if (tails.length === 0) return null;
  return new Date(Math.max(...tails.map((d) => d.getTime())));
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Subscribe tap — invoice link minting
// ---------------------------------------------------------------------------

async function handleSubscribeTap(
  ctx: Context,
  plan: "pro" | "business",
): Promise<void> {
  const userId = ctx.from?.id;
  if (userId === undefined) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }
  const ownerId = String(userId);

  let link: string;
  try {
    link = await createOrReuseInvoiceLink(ctx, ownerId, plan);
  } catch (err) {
    logger.warn({ err, ownerId, plan }, "createOrReuseInvoiceLink failed");
    await ctx
      .answerCallbackQuery({ text: "Couldn't create invoice — try again." })
      .catch(() => {});
    return;
  }

  await ctx
    .answerCallbackQuery({ text: TOAST_INVOICE_SENT })
    .catch(() => {});
  const kb = new InlineKeyboard().url("⭐ Subscribe", link);
  await ctx.reply(`⭐ ${planLabelFor(plan)} — tap below to pay with Stars.`, {
    reply_markup: kb,
  });
}

async function createOrReuseInvoiceLink(
  ctx: Context,
  ownerId: string,
  plan: "pro" | "business",
): Promise<string> {
  const cacheKey = `invoice:${ownerId}:${plan}`;
  const r = redis();

  // Reuse a recent link so two taps inside the cache window produce one
  // invoice / one nonce. Telegram client dedups by URL on its end.
  try {
    const cached = await r.get<{ nonce: string; link: string }>(cacheKey);
    if (cached && typeof cached.link === "string" && cached.link.length > 0) {
      return cached.link;
    }
  } catch (err) {
    // Redis read failure is non-fatal — we'll just mint a fresh link.
    logger.warn({ err, ownerId, plan }, "invoice cache read failed");
  }

  const nonce = generateNonce();
  const payload = `sub:${ownerId}:${plan}:${nonce}`;
  const config = PLANS[plan];
  const planLabel = planLabelFor(plan);

  // grammy's createInvoiceLink uses positional args matching the Telegram
  // Bot API param order: title, description, payload, provider_token,
  // currency, prices, then the rest as an `other` options bag. For Stars
  // payments provider_token MUST be an empty string.
  const link = await ctx.api.createInvoiceLink(
    `${planLabel} subscription`,
    `${planLabel} plan — ${config.maxBots} bots, ${config.maxDocsPerBot} docs/bot, ${config.maxMessagesPerPeriod.toLocaleString()} msgs/period.`,
    payload,
    "",
    STARS_CURRENCY,
    [{ label: `${planLabel} (30 days)`, amount: config.starsPerPeriod }],
    { subscription_period: SUBSCRIPTION_PERIOD_SECONDS },
  );

  try {
    await r.set(cacheKey, { nonce, link }, { ex: INVOICE_CACHE_TTL_SECONDS });
  } catch (err) {
    // Cache write failure is non-fatal — the link still works, we just
    // lose double-tap dedup for this owner this window.
    logger.warn({ err, ownerId, plan }, "invoice cache write failed");
  }

  return link;
}

function generateNonce(): string {
  // 16 hex chars = 8 bytes of randomness. Plenty for an idempotency key.
  const bytes = new Uint8Array(NONCE_LEN / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// pre_checkout_query
// ---------------------------------------------------------------------------

async function handlePreCheckoutQuery(ctx: Context): Promise<void> {
  const q = ctx.preCheckoutQuery;
  if (!q) return;

  const reject = async (reason: string): Promise<void> => {
    try {
      await ctx.answerPreCheckoutQuery(false, reason);
    } catch (err) {
      logger.warn({ err, reason }, "answerPreCheckoutQuery(false) failed");
    }
  };

  if (q.currency !== STARS_CURRENCY) {
    await reject("Unsupported currency");
    return;
  }

  const parsed = parsePayload(q.invoice_payload);
  if (!parsed) {
    await reject("Invalid payload");
    return;
  }
  const { ownerId, plan, nonce } = parsed;

  // Owner existence + ban check. We don't auto-create the row here — the
  // owner-capture middleware does that on every interaction; if it's
  // missing the owner has done something weird (third-party invoice tap).
  let ownerRow: { isBanned: boolean } | undefined;
  try {
    ownerRow = await db.query.owners.findFirst({
      where: eq(owners.telegramUserId, ownerId),
      columns: { isBanned: true },
    });
  } catch (err) {
    logger.warn({ err, ownerId }, "pre_checkout owner lookup failed");
    await reject("Service unavailable");
    return;
  }
  if (!ownerRow) {
    await reject("Owner not found");
    return;
  }
  if (ownerRow.isBanned) {
    await reject("Account restricted");
    return;
  }

  // Reject if owner is already active on the same plan — protects against
  // accidental double-subscription via a shared invoice link.
  try {
    const existing = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.ownerTelegramUserId, ownerId),
        eq(subscriptions.plan, plan),
        eq(subscriptions.status, "active"),
      ),
      columns: { id: true },
    });
    if (existing) {
      await reject("Already subscribed to this plan");
      return;
    }
  } catch (err) {
    logger.warn(
      { err, ownerId, plan },
      "pre_checkout active-sub lookup failed",
    );
    await reject("Service unavailable");
    return;
  }

  // Nonce dedup. If the nonce-used key is set, this invoice was already
  // consumed — reject to make replay attempts impossible.
  const r = redis();
  try {
    const usedKey = `nonce-used:${nonce}`;
    const used = await r.get<string>(usedKey);
    if (used) {
      await reject("Invoice already used");
      return;
    }
    // Mark in-flight. EX 600 is well past the 10-second window Telegram
    // gives us, and well past the time it takes for the successful_payment
    // update to arrive.
    await r.set(`nonce-pending:${nonce}`, "1", {
      ex: NONCE_PENDING_TTL_SECONDS,
    });
  } catch (err) {
    logger.warn({ err, ownerId, plan }, "pre_checkout nonce dedup failed");
    await reject("Service unavailable");
    return;
  }

  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (err) {
    logger.warn(
      { err, ownerId, plan },
      "answerPreCheckoutQuery(true) failed",
    );
  }
}

// ---------------------------------------------------------------------------
// successful_payment
// ---------------------------------------------------------------------------

async function handleSuccessfulPayment(ctx: Context): Promise<void> {
  const sp = ctx.message?.successful_payment;
  if (!sp) return;

  if (sp.currency !== STARS_CURRENCY) {
    // Not a Stars payment — nothing for our billing pipeline to do.
    logger.warn(
      { currency: sp.currency, payload: sp.invoice_payload },
      "successful_payment with non-XTR currency — ignoring",
    );
    return;
  }

  const parsed = parsePayload(sp.invoice_payload);
  if (!parsed) {
    logger.warn(
      { payload: sp.invoice_payload },
      "successful_payment with un-parsable payload — ignoring",
    );
    return;
  }
  const { ownerId, plan, nonce } = parsed;

  const r = redis();
  // Lock the nonce so any replay (e.g. Telegram redelivering the same
  // update, or a third party trying to re-use the invoice payload) is
  // rejected at pre_checkout next time around.
  try {
    await r.set(`nonce-used:${nonce}`, "1", { ex: NONCE_USED_TTL_SECONDS });
  } catch (err) {
    // Non-fatal. The DB unique constraint on telegram_payment_charge_id is
    // the canonical idempotency guarantee.
    logger.warn({ err, nonce }, "nonce-used lock write failed");
  }

  // Insert the ledger row first. If this throws (DB down), we surface the
  // error so Telegram retries the update — the ledger MUST land.
  await db.insert(starPayments).values({
    ownerTelegramUserId: ownerId,
    starsAmount: sp.total_amount,
    isFirstRecurring: sp.is_first_recurring === true,
    invoicePayload: sp.invoice_payload,
    rawSuccessfulPayment: sp as unknown as Record<string, unknown>,
  });

  // subscription_expiration_date is required for Stars subscription
  // payments. Default to "now + 30 days" if Telegram ever sends a payment
  // without it (defensive — the subscription handler still produces the
  // right downstream state).
  const expirationDate =
    sp.subscription_expiration_date ??
    Math.floor(Date.now() / 1000) + SUBSCRIPTION_PERIOD_SECONDS;

  const eventData: Events["subscription/started"] = {
    ownerTelegramUserId: ownerId,
    plan,
    telegramPaymentChargeId: sp.telegram_payment_charge_id,
    starsAmount: sp.total_amount,
    subscriptionExpirationDate: expirationDate,
  };

  const eventName: "subscription/started" | "subscription/renewed" =
    sp.is_first_recurring === true
      ? "subscription/started"
      : sp.is_recurring === true
        ? "subscription/renewed"
        : "subscription/started";

  try {
    await inngest.send({ name: eventName, data: eventData });
  } catch (err) {
    logger.error(
      { err, ownerId, plan, name: eventName },
      "inngest event send failed for successful_payment",
    );
    // Throwing here causes grammy to return 500 to Telegram, which retries.
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the invoice payload string `sub:{ownerId}:{plan}:{nonce}`.
 *
 * Returns null on:
 *   - wrong prefix
 *   - wrong number of fields
 *   - plan not in {pro, business} (trial is not purchasable)
 *   - nonce not exactly 16 hex chars
 *   - empty ownerId
 *
 * Exported for unit tests via the inline `_internals` namespace.
 */
function parsePayload(
  payload: string,
): { ownerId: string; plan: PlanKey & ("pro" | "business"); nonce: string } | null {
  if (typeof payload !== "string") return null;
  const parts = payload.split(":");
  if (parts.length !== 4) return null;
  const [prefix, ownerId, planRaw, nonce] = parts;
  if (prefix !== "sub") return null;
  if (!ownerId) return null;
  if (planRaw !== "pro" && planRaw !== "business") return null;
  if (!nonce || !/^[0-9a-f]{16}$/.test(nonce)) return null;
  return { ownerId, plan: planRaw, nonce };
}

// ---------------------------------------------------------------------------
// Internal exports for unit tests.
//
// Not exported from the bot app's public surface — onboarding.ts only uses
// `attachBillingHandlers` and `buildBillingMenuButton`. Tests import this
// namespace directly.
// ---------------------------------------------------------------------------

export const _internals = {
  parsePayload,
  composeBillingScreen,
  buildActionsKeyboard,
  planLabelFor,
  CB,
  SUBSCRIPTION_PERIOD_SECONDS,
  STARS_CURRENCY,
};
