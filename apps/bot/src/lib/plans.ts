/**
 * Plan configuration and the effective-plan helper.
 *
 * Pure data + pure functions only. No DB, Redis, or Telegram API access here.
 * Mirrors the "Plans & Pricing" and "State Machine" sections in SUBSCRIPTION.md.
 */

export type PlanKey = "trial" | "pro" | "business";

export interface PlanConfig {
  key: PlanKey;
  starsPerPeriod: number;
  maxBots: number;
  maxDocsPerBot: number;
  maxMessagesPerPeriod: number;
}

export const PLANS: Record<PlanKey, PlanConfig> = {
  trial: {
    key: "trial",
    starsPerPeriod: 0,
    maxBots: 1,
    maxDocsPerBot: 3,
    maxMessagesPerPeriod: 500,
  },
  pro: {
    key: "pro",
    starsPerPeriod: 300,
    maxBots: 3,
    maxDocsPerBot: 10,
    maxMessagesPerPeriod: 5000,
  },
  business: {
    key: "business",
    starsPerPeriod: 700,
    maxBots: 10,
    maxDocsPerBot: 50,
    maxMessagesPerPeriod: 50000,
  },
};

export type SubscriptionStatus = "trialing" | "active" | "canceled" | "lapsed";

export interface EffectivePlanSubscription {
  plan: PlanKey;
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
}

export interface EffectivePlanInput {
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
  subscriptions: ReadonlyArray<EffectivePlanSubscription>;
  /** Injectable clock for tests; defaults to `new Date()`. */
  now?: Date;
}

export type EffectivePlanResult =
  | { plan: PlanKey; status: "trialing" | "active" | "canceled" }
  | { plan: null; status: "lapsed" };

/**
 * Compute the effective plan for an owner from their subscriptions row(s).
 *
 * Logic (see SUBSCRIPTION.md "State Machine"):
 *   1. `live` = subs where status="active" OR (status="canceled" AND currentPeriodEnd > now).
 *   2. If any live sub is business → "business".
 *   3. Else if any live sub is pro → "pro".
 *   4. Else if owner is trialing AND (trialEndsAt is null OR trialEndsAt > now) → "trial".
 *      Null trialEndsAt means "trial hasn't started yet" — the owner row was
 *      seeded by owner-capture middleware before they created their first bot.
 *      Treating that as trial (not lapsed) lets the bot-create gate pass so
 *      `startTrialOnFirstBot` can actually run and set trialEndsAt.
 *   5. Else → lapsed.
 *
 * When multiple live subs share the winning tier, prefer "active" over "canceled".
 */
export function effectivePlan(input: EffectivePlanInput): EffectivePlanResult {
  const now = input.now ?? new Date();

  const live = input.subscriptions.filter(
    (s) =>
      s.status === "active" ||
      (s.status === "canceled" && s.currentPeriodEnd.getTime() > now.getTime()),
  );

  const businessSubs = live.filter((s) => s.plan === "business");
  if (businessSubs.length > 0) {
    return {
      plan: "business",
      status: pickBestLiveStatus(businessSubs),
    };
  }

  const proSubs = live.filter((s) => s.plan === "pro");
  if (proSubs.length > 0) {
    return {
      plan: "pro",
      status: pickBestLiveStatus(proSubs),
    };
  }

  if (input.subscriptionStatus === "trialing") {
    const trialStillLive =
      input.trialEndsAt === null ||
      input.trialEndsAt.getTime() > now.getTime();
    if (trialStillLive) {
      return { plan: "trial", status: "trialing" };
    }
  }

  return { plan: null, status: "lapsed" };
}

function pickBestLiveStatus(
  subs: ReadonlyArray<EffectivePlanSubscription>,
): "active" | "canceled" {
  // Precedence: active > canceled. Only "active" and "canceled (still in period)"
  // can appear here because of the `live` filter in effectivePlan.
  return subs.some((s) => s.status === "active") ? "active" : "canceled";
}

/**
 * Convenience accessor for the cap fields of a plan.
 */
export function planLimits(
  plan: PlanKey,
): Pick<PlanConfig, "maxBots" | "maxDocsPerBot" | "maxMessagesPerPeriod"> {
  const config = PLANS[plan];
  return {
    maxBots: config.maxBots,
    maxDocsPerBot: config.maxDocsPerBot,
    maxMessagesPerPeriod: config.maxMessagesPerPeriod,
  };
}

/**
 * Effective per-user daily AI-reply cap for a bot.
 *
 * - `configured` is the value on `tenant_bots.daily_user_ai_reply_limit`.
 *   `null` means the owner has not set a cap → unlimited up to plan ceiling.
 * - `plan` is the owner's effective plan. Lapsed owners get `null` and we
 *   fall back to the trial cap (defensive — bots should already be paused
 *   in that case, but we don't want infinite generation if quota
 *   enforcement is bypassed).
 *
 * Always returns a finite, positive integer. The plan cap is the hard
 * upper bound — the owner cannot bypass it even with a higher configured
 * value, and downgrading a plan auto-tightens previously-permissive caps.
 */
export function effectiveDailyAiReplyCap(
  configured: number | null | undefined,
  plan: PlanKey | null,
): number {
  const ceiling = PLANS[plan ?? "trial"].maxMessagesPerPeriod;
  if (configured === null || configured === undefined) return ceiling;
  if (!Number.isFinite(configured) || configured <= 0) return ceiling;
  return Math.min(configured, ceiling);
}

/**
 * Validate an owner-supplied cap value for plan tier `plan`.
 *
 * Returns `{ ok: true, value }` when the input is a positive integer not
 * exceeding the plan's monthly ceiling. Otherwise returns a structured
 * error the UI can render verbatim.
 */
export type DailyCapValidation =
  | { ok: true; value: number | null }
  | { ok: false; reason: "not_an_integer" | "not_positive" | "exceeds_plan"; ceiling: number };

export function validateDailyCap(
  input: number | null,
  plan: PlanKey,
): DailyCapValidation {
  const ceiling = PLANS[plan].maxMessagesPerPeriod;
  if (input === null) return { ok: true, value: null };
  if (!Number.isFinite(input) || !Number.isInteger(input)) {
    return { ok: false, reason: "not_an_integer", ceiling };
  }
  if (input <= 0) {
    return { ok: false, reason: "not_positive", ceiling };
  }
  if (input > ceiling) {
    return { ok: false, reason: "exceeds_plan", ceiling };
  }
  return { ok: true, value: input };
}
