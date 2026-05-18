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
import {
  cancelStarSubscription,
  resumeStarSubscription,
} from "../inngest/handlers/_telegram";
import { logger } from "../lib/logger";
import { PLANS, planLimits, type PlanKey } from "../lib/plans";
import { recomputeEffectivePlan } from "../lib/owners";
import { redis } from "../lib/redis";
import {
  CANCEL_REASON_PROMPT,
  CANCEL_REASONS,
  PLAN_PICKER_HEADER,
  TOAST_INVOICE_SENT,
  billingHeader,
  billingUsageBlock,
  cancelConfirmPrompt,
  planPickerLine,
  upgradeConfirmPrompt,
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
  upgradeConfirm: "billing_upgrade_confirm",
  cancel: "billing_cancel",
  /** Dismiss the cancel-confirm prompt without re-rendering /billing. */
  keepSubscription: "billing_keep",
  resume: "billing_resume",
  /** Prefix for `billing_cancel_confirm_{subUuid}`. We embed the
   *  subscription row's UUID (36 chars) instead of the Telegram payment
   *  charge id (~140 chars) because Telegram caps callback_data at 64
   *  bytes. The handler resolves UUID → chargeId via a DB lookup. */
  cancelConfirmPrefix: "billing_cancel_confirm_",
  /** Prefix for `billing_cancel_reason_{key}_{subUuid}`. Same reason as
   *  cancelConfirmPrefix — UUID, not chargeId. */
  cancelReasonPrefix: "billing_cancel_reason_",
} as const;

/** Regex for `billing_cancel_confirm_{subUuid}`. */
const CANCEL_CONFIRM_RE = /^billing_cancel_confirm_(.+)$/;

/** Regex for `billing_cancel_reason_{reasonKey}_{chargeId}`. Reason key is
 *  one of `CANCEL_REASONS` (snake-case, no underscores between key + id
 *  beyond the canonical separator). We use a non-greedy split: the FIRST
 *  underscore-delimited token after the prefix is the reason key; the rest
 *  is the charge id. Reason keys are statically allow-listed below. */
const CANCEL_REASON_KEYS = new Set(CANCEL_REASONS.map((r) => r.key));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BillingStatus = "trialing" | "active" | "canceled" | "lapsed";

interface OwnerSubRow {
  /** Subscription row UUID — short enough to embed in Telegram's 64-byte
   *  callback_data, unlike telegramPaymentChargeId which routinely runs
   *  ~140 chars and would push callback strings past Telegram's limit. */
  id: string;
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
    await handleUpgradeTap(ctx);
  });

  bot.callbackQuery(CB.upgradeConfirm, async (ctx) => {
    await handleUpgradeConfirm(ctx);
  });

  bot.callbackQuery(CB.cancel, async (ctx) => {
    await handleCancelTap(ctx);
  });

  // "Keep subscription" — owner backed out of the cancel prompt. Delete
  // the prompt and re-render /billing (the prior /billing message was
  // already deleted in handleCancelTap, so this restores the surface).
  bot.callbackQuery(CB.keepSubscription, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.deleteMessage().catch(() => {});
    const userId = ctx.from?.id;
    if (userId !== undefined) {
      await renderBillingScreen(ctx, String(userId));
    }
  });

  bot.callbackQuery(CANCEL_CONFIRM_RE, async (ctx) => {
    const subId = parseCancelConfirmCallback(ctx.callbackQuery?.data);
    if (!subId) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    await handleCancelConfirm(ctx, subId);
  });

  bot.callbackQuery(/^billing_cancel_reason_/, async (ctx) => {
    const parsed = parseCancelReasonCallback(ctx.callbackQuery?.data);
    if (!parsed) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    await handleCancelReason(ctx, parsed.key, parsed.subId);
  });

  bot.callbackQuery(CB.resume, async (ctx) => {
    await handleResumeTap(ctx);
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
        id: true,
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
        id: s.id,
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
    // Null trial_ends_at = pre-trial (owner hasn't created their first bot
    // yet). Pass `null` through so the header renders the pre-trial nudge
    // instead of "0 days left".
    const daysLeft: number | null = state.trialEndsAt
      ? Math.max(
          0,
          Math.ceil(
            (state.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
          ),
        )
      : null;
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
// Cancel flow
// ---------------------------------------------------------------------------

/**
 * "Cancel subscription" button tap. Loads the owner's primary subscription
 * (highest tier with status='active', or canceled-still-in-period as fall
 * back) and shows the typed confirm prompt with two buttons.
 */
async function handleCancelTap(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  // Drop the /billing screen that hosted the Cancel button so the owner
  // can't scroll up and tap a stale one later.
  await ctx.deleteMessage().catch(() => {});
  const userId = ctx.from?.id;
  if (userId === undefined) return;
  const ownerId = String(userId);

  const primary = await loadPrimarySubscription(ownerId);
  if (!primary) {
    // Nothing to cancel — re-render the menu so the owner gets a fresh
    // surface rather than a silent no-op.
    await renderBillingScreen(ctx, ownerId);
    return;
  }

  const body = cancelConfirmPrompt({
    planLabel: planLabelFor(primary.plan),
    endsOn: formatDate(primary.currentPeriodEnd),
  });
  const kb = new InlineKeyboard()
    .text("Yes, cancel", `${CB.cancelConfirmPrefix}${primary.id}`)
    .row()
    .text("Keep subscription", CB.keepSubscription);

  await ctx.reply(body, { parse_mode: "HTML", reply_markup: kb });
}

/**
 * "Yes, cancel" confirmation. Calls Telegram to disable auto-renew, flips
 * the DB row, fires `subscription/canceled`, and surfaces the reason picker.
 */
async function handleCancelConfirm(
  ctx: Context,
  subId: string,
): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  // Drop the "Are you sure?" prompt immediately — owner committed.
  await ctx.deleteMessage().catch(() => {});
  const userId = ctx.from?.id;
  if (userId === undefined) return;
  const ownerTelegramUserId = String(userId);

  // Resolve sub UUID → chargeId, with ownership double-check.
  let telegramPaymentChargeId: string | null = null;
  try {
    const row = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.id, subId),
        eq(subscriptions.ownerTelegramUserId, ownerTelegramUserId),
      ),
      columns: { telegramPaymentChargeId: true },
    });
    telegramPaymentChargeId = row?.telegramPaymentChargeId ?? null;
  } catch (err) {
    logger.warn(
      { err, ownerTelegramUserId, subId },
      "cancel-confirm: subscription lookup failed",
    );
  }
  if (!telegramPaymentChargeId) {
    await ctx.deleteMessage().catch(() => {});
    await renderBillingScreen(ctx, ownerTelegramUserId);
    return;
  }

  // 1. Telegram-side: switch auto-renew off. Fail-open — DB is canonical.
  await cancelStarSubscription({
    ownerTelegramUserId,
    telegramPaymentChargeId,
  }).catch((err) => {
    logger.warn(
      { err, ownerTelegramUserId, subId },
      "cancelStarSubscription threw — continuing with DB update",
    );
    return false;
  });

  // 2. DB: mark this row canceled. Scoped by sub id + owner.
  try {
    await db
      .update(subscriptions)
      .set({ status: "canceled", canceledAt: new Date() })
      .where(
        and(
          eq(subscriptions.id, subId),
          eq(subscriptions.ownerTelegramUserId, ownerTelegramUserId),
        ),
      );
  } catch (err) {
    logger.warn(
      { err, ownerTelegramUserId, subId },
      "cancel-confirm DB update failed",
    );
  }

  // 3. Fan out (notify/owner + recompute plan).
  try {
    await inngest.send({
      name: "subscription/canceled",
      data: {
        ownerTelegramUserId,
        telegramPaymentChargeId,
      },
    });
  } catch (err) {
    logger.warn(
      { err, ownerTelegramUserId, subId },
      "subscription/canceled inngest send failed",
    );
  }

  // 4. Reason picker. Callback embeds sub UUID, not chargeId, to stay
  //    within Telegram's 64-byte callback_data cap.
  const kb = new InlineKeyboard();
  for (const reason of CANCEL_REASONS) {
    kb.text(
      reason.label,
      `${CB.cancelReasonPrefix}${reason.key}_${subId}`,
    ).row();
  }
  kb.text("Skip", CB.menu);
  await ctx.reply(CANCEL_REASON_PROMPT, { reply_markup: kb });
}

/**
 * Owner picks a cancellation reason. Persists it on the subscription row
 * and re-renders the billing screen.
 */
async function handleCancelReason(
  ctx: Context,
  reasonKey: string,
  subId: string,
): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  const userId = ctx.from?.id;
  if (userId === undefined) return;
  const ownerTelegramUserId = String(userId);

  try {
    await db
      .update(subscriptions)
      .set({ cancelReason: reasonKey })
      .where(
        and(
          eq(subscriptions.id, subId),
          eq(subscriptions.ownerTelegramUserId, ownerTelegramUserId),
        ),
      );
  } catch (err) {
    logger.warn(
      { err, ownerTelegramUserId, subId, reasonKey },
      "cancel-reason DB update failed",
    );
  }

  await ctx.deleteMessage().catch(() => {});
  await renderBillingScreen(ctx, ownerTelegramUserId);
}

// ---------------------------------------------------------------------------
// Resume flow
// ---------------------------------------------------------------------------

/**
 * "Resume subscription" button tap. Finds the most recent canceled-but-not-
 * yet-lapsed subscription and re-enables Telegram auto-renew + DB status.
 */
async function handleResumeTap(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  const userId = ctx.from?.id;
  if (userId === undefined) return;
  const ownerTelegramUserId = String(userId);

  const target = await loadResumableSubscription(ownerTelegramUserId);
  if (!target) {
    await ctx.deleteMessage().catch(() => {});
    await renderBillingScreen(ctx, ownerTelegramUserId);
    return;
  }

  await resumeStarSubscription({
    ownerTelegramUserId,
    telegramPaymentChargeId: target.telegramPaymentChargeId,
  }).catch((err) => {
    logger.warn(
      {
        err,
        ownerTelegramUserId,
        telegramPaymentChargeId: target.telegramPaymentChargeId,
      },
      "resumeStarSubscription threw — continuing with DB update",
    );
    return false;
  });

  try {
    await db
      .update(subscriptions)
      .set({ status: "active", canceledAt: null })
      .where(
        and(
          eq(
            subscriptions.telegramPaymentChargeId,
            target.telegramPaymentChargeId,
          ),
          eq(subscriptions.ownerTelegramUserId, ownerTelegramUserId),
        ),
      );
  } catch (err) {
    logger.warn(
      {
        err,
        ownerTelegramUserId,
        telegramPaymentChargeId: target.telegramPaymentChargeId,
      },
      "resume DB update failed",
    );
  }

  // Recompute owners.current_plan / subscription_status from the fresh
  // subs view so the /billing screen below reflects the resumed state.
  // Cancel flips owners.subscription_status='canceled' via the Inngest
  // handler — there's no corresponding inngest event for resume, so we
  // call the recompute directly here.
  try {
    await recomputeEffectivePlan(ownerTelegramUserId);
  } catch (err) {
    logger.warn(
      { err, ownerTelegramUserId },
      "recomputeEffectivePlan after resume failed",
    );
  }

  try {
    await inngest.send({
      name: "notify/owner",
      data: {
        kind: "subscription_resumed",
        ownerTelegramUserId,
        extras: { plan: target.plan },
      },
    });
  } catch (err) {
    logger.warn(
      { err, ownerTelegramUserId },
      "notify/owner (subscription_resumed) send failed",
    );
  }

  await ctx.deleteMessage().catch(() => {});
  await renderBillingScreen(ctx, ownerTelegramUserId);
}

// ---------------------------------------------------------------------------
// Upgrade Pro → Business
// ---------------------------------------------------------------------------

/**
 * "Upgrade to Business" tap. Pro owner only. Surfaces the service-overlap
 * confirmation; the actual cancel-Pro + Business-invoice flow runs on
 * `billing_upgrade_confirm`.
 */
async function handleUpgradeTap(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  const userId = ctx.from?.id;
  if (userId === undefined) return;
  const ownerId = String(userId);

  const proSub = await loadActiveProSubscription(ownerId);
  if (!proSub) {
    // Not on Pro — re-render menu so the owner sees the current state.
    await ctx.deleteMessage().catch(() => {});
    await renderBillingScreen(ctx, ownerId);
    return;
  }

  const body = upgradeConfirmPrompt({
    stars: PLANS.business.starsPerPeriod,
    endsOn: formatDate(proSub.currentPeriodEnd),
  });
  const kb = new InlineKeyboard()
    .text("Confirm upgrade", CB.upgradeConfirm)
    .row()
    .text("Cancel", CB.menu);

  await ctx.reply(body, { parse_mode: "HTML", reply_markup: kb });
}

/**
 * "Confirm upgrade" — service-overlap strategy from SUBSCRIPTION.md:
 *   1. Cancel Pro auto-renew (Pro keeps running until its currentPeriodEnd).
 *   2. Flip Pro's row to canceled in DB.
 *   3. Mint a Business invoice and send it as a tap-to-pay button. The
 *      regular `successful_payment` handler picks up the Business charge.
 */
async function handleUpgradeConfirm(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  const userId = ctx.from?.id;
  if (userId === undefined) return;
  const ownerTelegramUserId = String(userId);

  const proSub = await loadActiveProSubscription(ownerTelegramUserId);
  if (!proSub) {
    // Owner isn't on Pro anymore (maybe they upgraded in another session) —
    // bail back to the menu.
    await ctx.deleteMessage().catch(() => {});
    await renderBillingScreen(ctx, ownerTelegramUserId);
    return;
  }

  // 1. Telegram: disable Pro auto-renew. Pro service continues until
  //    currentPeriodEnd. Fail-open so a transient Telegram blip doesn't
  //    block the upgrade.
  await cancelStarSubscription({
    ownerTelegramUserId,
    telegramPaymentChargeId: proSub.telegramPaymentChargeId,
  }).catch((err) => {
    logger.warn(
      {
        err,
        ownerTelegramUserId,
        telegramPaymentChargeId: proSub.telegramPaymentChargeId,
      },
      "upgrade cancelStarSubscription(Pro) threw — continuing",
    );
    return false;
  });

  // 2. DB: flip Pro's status to canceled. The new Business row lands when
  //    `successful_payment` fires after the owner pays the invoice.
  try {
    await db
      .update(subscriptions)
      .set({ status: "canceled", canceledAt: new Date() })
      .where(
        and(
          eq(
            subscriptions.telegramPaymentChargeId,
            proSub.telegramPaymentChargeId,
          ),
          eq(subscriptions.ownerTelegramUserId, ownerTelegramUserId),
        ),
      );
  } catch (err) {
    logger.warn(
      { err, ownerTelegramUserId },
      "upgrade Pro→Business DB cancel update failed",
    );
  }

  // 3. Mint the Business invoice. Reuses the existing helper so the
  //    cache-key / nonce / payload format are identical to a fresh subscribe.
  let link: string;
  try {
    link = await createOrReuseInvoiceLink(ctx, ownerTelegramUserId, "business");
  } catch (err) {
    logger.warn(
      { err, ownerTelegramUserId },
      "upgrade createOrReuseInvoiceLink(business) failed",
    );
    await ctx
      .reply("Couldn't create invoice — try again from /billing.")
      .catch(() => {});
    return;
  }

  const kb = new InlineKeyboard().url("⭐ Pay 2000 Stars", link);
  await ctx.reply(
    "⭐ Business — tap below to pay with Stars. Your Pro plan keeps running until its end date at no extra charge.",
    { reply_markup: kb },
  );
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

  // Payment-amount validation. Defense in depth: if a webhook-secret leak
  // ever let an attacker craft a successful_payment with a smaller
  // total_amount, this rejects at pre_checkout before money moves.
  const expectedAmount = PLANS[plan].starsPerPeriod;
  if (q.total_amount !== expectedAmount) {
    logger.warn(
      { ownerId, plan, expected: expectedAmount, received: q.total_amount },
      "pre_checkout total_amount mismatch — rejecting",
    );
    await reject("Invoice amount tampered");
    return;
  }

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

  // Nonce dedup. Atomic SET NX EX on the in-flight lock — wins iff no
  // prior pre_checkout for this nonce has been approved (and no
  // successful_payment has marked it used). Replaces the previous
  // GET-then-SET pair, which had a race window where two concurrent
  // pre_checkout calls could both pass the GET.
  const r = redis();
  try {
    const pendingKey = `nonce-pending:${nonce}`;
    const usedKey = `nonce-used:${nonce}`;
    const claim = await r.set(pendingKey, "1", {
      nx: true,
      ex: NONCE_PENDING_TTL_SECONDS,
    });
    if (claim !== "OK") {
      // Either an in-flight pre_checkout already won the slot, or the
      // payment has already completed and `nonce-used` was set. Either way
      // this invoice can't be charged again.
      await reject("Invoice already used");
      return;
    }
    // Defensive second check: if successful_payment ran extremely fast in
    // between, the used-key may exist. Honor it.
    const used = await r.get<string>(usedKey);
    if (used) {
      await reject("Invoice already used");
      return;
    }
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
 * Parse a `billing_cancel_confirm_{subId}` callback. Returns the
 * subscription row UUID, or null on prefix mismatch / empty id. We use the
 * sub UUID (36 chars) instead of telegram_payment_charge_id (~140 chars)
 * to stay within Telegram's 64-byte callback_data cap.
 */
function parseCancelConfirmCallback(
  data: string | undefined,
): string | null {
  if (typeof data !== "string") return null;
  const m = CANCEL_CONFIRM_RE.exec(data);
  if (!m) return null;
  const subId = m[1];
  if (!subId) return null;
  return subId;
}

/**
 * Parse a `billing_cancel_reason_{key}_{subId}` callback. The reason key
 * comes from a static allow-list (`CANCEL_REASONS`), so we split off the
 * longest known-key prefix and treat the rest as the sub UUID.
 */
function parseCancelReasonCallback(
  data: string | undefined,
): { key: string; subId: string } | null {
  if (typeof data !== "string") return null;
  if (!data.startsWith(CB.cancelReasonPrefix)) return null;
  const remainder = data.slice(CB.cancelReasonPrefix.length);
  if (remainder.length === 0) return null;

  const keys = [...CANCEL_REASON_KEYS].sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const prefix = `${key}_`;
    if (remainder.startsWith(prefix)) {
      const subId = remainder.slice(prefix.length);
      if (subId.length === 0) return null;
      return { key, subId };
    }
  }
  return null;
}

/**
 * Load the owner's "primary" subscription for cancel-button purposes:
 * highest-tier among active subscriptions, falling back to canceled-but-
 * still-in-period if none are active. Returns null when nothing fits.
 */
async function loadPrimarySubscription(
  ownerId: string,
): Promise<OwnerSubRow | null> {
  try {
    const rows = await db.query.subscriptions.findMany({
      where: eq(subscriptions.ownerTelegramUserId, ownerId),
      columns: {
        id: true,
        plan: true,
        status: true,
        currentPeriodEnd: true,
        telegramPaymentChargeId: true,
      },
      orderBy: [desc(subscriptions.createdAt)],
    });
    if (rows.length === 0) return null;
    const now = Date.now();
    const tierRank: Record<PlanKey, number> = { trial: 0, pro: 1, business: 2 };

    const active = rows.filter((r) => r.status === "active");
    if (active.length > 0) {
      return [...active].sort(
        (a, b) => tierRank[b.plan] - tierRank[a.plan],
      )[0]!;
    }

    const canceledLive = rows.filter(
      (r) => r.status === "canceled" && r.currentPeriodEnd.getTime() > now,
    );
    if (canceledLive.length > 0) {
      return [...canceledLive].sort(
        (a, b) => tierRank[b.plan] - tierRank[a.plan],
      )[0]!;
    }

    return null;
  } catch (err) {
    logger.warn({ err, ownerId }, "loadPrimarySubscription failed");
    return null;
  }
}

/**
 * Find the most recent canceled-but-still-in-period subscription for an
 * owner. That's what the Resume button operates on.
 */
async function loadResumableSubscription(
  ownerId: string,
): Promise<OwnerSubRow | null> {
  try {
    const rows = await db.query.subscriptions.findMany({
      where: and(
        eq(subscriptions.ownerTelegramUserId, ownerId),
        eq(subscriptions.status, "canceled"),
      ),
      columns: {
        id: true,
        plan: true,
        status: true,
        currentPeriodEnd: true,
        telegramPaymentChargeId: true,
      },
      orderBy: [desc(subscriptions.createdAt)],
    });
    const now = Date.now();
    for (const r of rows) {
      if (r.currentPeriodEnd.getTime() > now) return r;
    }
    return null;
  } catch (err) {
    logger.warn({ err, ownerId }, "loadResumableSubscription failed");
    return null;
  }
}

/**
 * Look up the owner's currently-active Pro subscription. Used by the upgrade
 * flow to identify which charge to cancel auto-renew on.
 */
async function loadActiveProSubscription(
  ownerId: string,
): Promise<OwnerSubRow | null> {
  try {
    const row = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.ownerTelegramUserId, ownerId),
        eq(subscriptions.plan, "pro"),
        eq(subscriptions.status, "active"),
      ),
      columns: {
        id: true,
        plan: true,
        status: true,
        currentPeriodEnd: true,
        telegramPaymentChargeId: true,
      },
    });
    return row ?? null;
  } catch (err) {
    logger.warn({ err, ownerId }, "loadActiveProSubscription failed");
    return null;
  }
}

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
  parseCancelConfirmCallback,
  parseCancelReasonCallback,
  composeBillingScreen,
  buildActionsKeyboard,
  planLabelFor,
  CB,
  CANCEL_CONFIRM_RE,
  SUBSCRIPTION_PERIOD_SECONDS,
  STARS_CURRENCY,
};
