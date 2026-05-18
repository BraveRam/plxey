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
    // TEST-PHASE PRICING: 2 stars instead of the production 500. Reset
    // before public launch (see SUBSCRIPTION.md "Plans & Pricing").
    starsPerPeriod: 2,
    maxBots: 3,
    maxDocsPerBot: 10,
    maxMessagesPerPeriod: 5000,
  },
  business: {
    key: "business",
    // TEST-PHASE PRICING: 5 stars instead of the production 2000.
    starsPerPeriod: 5,
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
