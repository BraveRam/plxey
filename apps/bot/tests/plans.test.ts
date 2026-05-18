import { describe, expect, test } from "bun:test";
import type { EffectivePlanSubscription } from "../src/lib/plans";
import {
  PLANS,
  effectiveDailyAiReplyCap,
  effectivePlan,
  planLimits,
  validateDailyCap,
} from "../src/lib/plans";

const NOW = new Date("2026-05-17T12:00:00.000Z");

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function sub(
  partial: Partial<EffectivePlanSubscription> &
    Pick<EffectivePlanSubscription, "plan" | "status">,
): EffectivePlanSubscription {
  return {
    currentPeriodEnd: addDays(NOW, 30),
    ...partial,
  };
}

describe("PLANS", () => {
  test("trial has the exact caps from SUBSCRIPTION.md", () => {
    expect(PLANS.trial).toEqual({
      key: "trial",
      starsPerPeriod: 0,
      maxBots: 1,
      maxDocsPerBot: 3,
      maxMessagesPerPeriod: 500,
    });
  });

  test("pro has the exact caps from SUBSCRIPTION.md", () => {
    expect(PLANS.pro).toEqual({
      key: "pro",
      // TEST-PHASE PRICING: 2 stars (prod target: 500). Bump back
      // before public launch.
      starsPerPeriod: 2,
      maxBots: 3,
      maxDocsPerBot: 10,
      maxMessagesPerPeriod: 5000,
    });
  });

  test("business has the exact caps from SUBSCRIPTION.md", () => {
    expect(PLANS.business).toEqual({
      key: "business",
      // TEST-PHASE PRICING: 5 stars (prod target: 2000). Bump back
      // before public launch.
      starsPerPeriod: 5,
      maxBots: 10,
      maxDocsPerBot: 50,
      maxMessagesPerPeriod: 50000,
    });
  });
});

describe("effectivePlan", () => {
  test("returns trial when in the trialing window with no subscriptions", () => {
    const result = effectivePlan({
      subscriptionStatus: "trialing",
      trialEndsAt: addDays(NOW, 7),
      subscriptions: [],
      now: NOW,
    });
    expect(result).toEqual({ plan: "trial", status: "trialing" });
  });

  test("returns lapsed when trial expired and no subscriptions exist", () => {
    const result = effectivePlan({
      subscriptionStatus: "trialing",
      trialEndsAt: addDays(NOW, -1),
      subscriptions: [],
      now: NOW,
    });
    expect(result).toEqual({ plan: null, status: "lapsed" });
  });

  test("returns trial when trialing AND trialEndsAt is null (pre-trial: owner exists but hasn't created first bot)", () => {
    const result = effectivePlan({
      subscriptionStatus: "trialing",
      trialEndsAt: null,
      subscriptions: [],
      now: NOW,
    });
    // Null trial_ends_at means startTrialOnFirstBot hasn't run yet.
    // We treat it as live trial so the bot-create gate lets them through.
    expect(result).toEqual({ plan: "trial", status: "trialing" });
  });

  test("returns lapsed when trialEndsAt is null and no subscriptions exist", () => {
    const result = effectivePlan({
      subscriptionStatus: "lapsed",
      trialEndsAt: null,
      subscriptions: [],
      now: NOW,
    });
    expect(result).toEqual({ plan: null, status: "lapsed" });
  });

  test("picks business over pro when both are active", () => {
    const result = effectivePlan({
      subscriptionStatus: "active",
      trialEndsAt: null,
      subscriptions: [
        sub({ plan: "pro", status: "active" }),
        sub({ plan: "business", status: "active" }),
      ],
      now: NOW,
    });
    expect(result).toEqual({ plan: "business", status: "active" });
  });

  test("picks pro when only pro is active", () => {
    const result = effectivePlan({
      subscriptionStatus: "active",
      trialEndsAt: null,
      subscriptions: [sub({ plan: "pro", status: "active" })],
      now: NOW,
    });
    expect(result).toEqual({ plan: "pro", status: "active" });
  });

  test("picks business over a canceled-pro tail still inside its period", () => {
    const result = effectivePlan({
      subscriptionStatus: "active",
      trialEndsAt: null,
      subscriptions: [
        sub({
          plan: "pro",
          status: "canceled",
          currentPeriodEnd: addDays(NOW, 5),
        }),
        sub({ plan: "business", status: "active" }),
      ],
      now: NOW,
    });
    expect(result).toEqual({ plan: "business", status: "active" });
  });

  test("picks the canceled-pro tail while it is still inside its period", () => {
    const result = effectivePlan({
      subscriptionStatus: "canceled",
      trialEndsAt: null,
      subscriptions: [
        sub({
          plan: "pro",
          status: "canceled",
          currentPeriodEnd: addDays(NOW, 5),
        }),
      ],
      now: NOW,
    });
    expect(result).toEqual({ plan: "pro", status: "canceled" });
  });

  test("lapses when the canceled-pro tail's period has ended", () => {
    const result = effectivePlan({
      subscriptionStatus: "canceled",
      trialEndsAt: null,
      subscriptions: [
        sub({
          plan: "pro",
          status: "canceled",
          currentPeriodEnd: addDays(NOW, -1),
        }),
      ],
      now: NOW,
    });
    expect(result).toEqual({ plan: null, status: "lapsed" });
  });

  test("returns active status when one active sub exists", () => {
    const result = effectivePlan({
      subscriptionStatus: "active",
      trialEndsAt: null,
      subscriptions: [sub({ plan: "business", status: "active" })],
      now: NOW,
    });
    expect(result).toEqual({ plan: "business", status: "active" });
  });

  test("returns canceled status when only a canceled (still-in-period) sub exists", () => {
    const result = effectivePlan({
      subscriptionStatus: "canceled",
      trialEndsAt: null,
      subscriptions: [
        sub({
          plan: "business",
          status: "canceled",
          currentPeriodEnd: addDays(NOW, 3),
        }),
      ],
      now: NOW,
    });
    expect(result).toEqual({ plan: "business", status: "canceled" });
  });

  test("prefers active over canceled when both exist at the winning tier", () => {
    const result = effectivePlan({
      subscriptionStatus: "active",
      trialEndsAt: null,
      subscriptions: [
        sub({
          plan: "pro",
          status: "canceled",
          currentPeriodEnd: addDays(NOW, 5),
        }),
        sub({ plan: "pro", status: "active" }),
      ],
      now: NOW,
    });
    expect(result).toEqual({ plan: "pro", status: "active" });
  });

  test("ignores lapsed subscriptions in the live set", () => {
    const result = effectivePlan({
      subscriptionStatus: "lapsed",
      trialEndsAt: null,
      subscriptions: [
        sub({
          plan: "business",
          status: "lapsed",
          currentPeriodEnd: addDays(NOW, -10),
        }),
      ],
      now: NOW,
    });
    expect(result).toEqual({ plan: null, status: "lapsed" });
  });

  test("paid-stack beats trial when both are live (Business while in trial)", () => {
    const result = effectivePlan({
      subscriptionStatus: "trialing",
      trialEndsAt: addDays(NOW, 7),
      subscriptions: [sub({ plan: "business", status: "active" })],
      now: NOW,
    });
    expect(result).toEqual({ plan: "business", status: "active" });
  });

  test("defaults to new Date() when `now` is omitted", () => {
    // A trial that ends far in the future will resolve to trial regardless of the
    // real wall-clock — guards that the default branch is reachable.
    const result = effectivePlan({
      subscriptionStatus: "trialing",
      trialEndsAt: new Date("2099-01-01T00:00:00.000Z"),
      subscriptions: [],
    });
    expect(result).toEqual({ plan: "trial", status: "trialing" });
  });
});

describe("planLimits", () => {
  test("returns trial limits", () => {
    expect(planLimits("trial")).toEqual({
      maxBots: 1,
      maxDocsPerBot: 3,
      maxMessagesPerPeriod: 500,
    });
  });

  test("returns pro limits", () => {
    expect(planLimits("pro")).toEqual({
      maxBots: 3,
      maxDocsPerBot: 10,
      maxMessagesPerPeriod: 5000,
    });
  });

  test("returns business limits", () => {
    expect(planLimits("business")).toEqual({
      maxBots: 10,
      maxDocsPerBot: 50,
      maxMessagesPerPeriod: 50000,
    });
  });
});

describe("effectiveDailyAiReplyCap", () => {
  test("null configured → plan ceiling for Pro", () => {
    expect(effectiveDailyAiReplyCap(null, "pro")).toBe(5000);
  });

  test("null configured → plan ceiling for Business", () => {
    expect(effectiveDailyAiReplyCap(null, "business")).toBe(50000);
  });

  test("null configured → trial ceiling for Trial", () => {
    expect(effectiveDailyAiReplyCap(null, "trial")).toBe(500);
  });

  test("configured ≤ plan ceiling is honored", () => {
    expect(effectiveDailyAiReplyCap(20, "pro")).toBe(20);
  });

  test("configured > plan ceiling is clamped down", () => {
    // Owner set 9999 while on Pro (5000 cap) — clamp to 5000.
    expect(effectiveDailyAiReplyCap(9999, "pro")).toBe(5000);
  });

  test("downgrade auto-tightens at read time", () => {
    // Owner had 4000 set while on Business, now lapsed/trial — read-time
    // clamp pulls it down to the trial ceiling.
    expect(effectiveDailyAiReplyCap(4000, "trial")).toBe(500);
  });

  test("lapsed (null plan) defends with trial ceiling", () => {
    expect(effectiveDailyAiReplyCap(null, null)).toBe(500);
  });

  test("zero or negative configured falls back to ceiling", () => {
    expect(effectiveDailyAiReplyCap(0, "pro")).toBe(5000);
    expect(effectiveDailyAiReplyCap(-1, "pro")).toBe(5000);
  });

  test("NaN configured falls back to ceiling", () => {
    expect(effectiveDailyAiReplyCap(Number.NaN, "pro")).toBe(5000);
  });
});

describe("validateDailyCap", () => {
  test("null = unset → ok", () => {
    expect(validateDailyCap(null, "pro")).toEqual({ ok: true, value: null });
  });

  test("positive int within plan cap → ok", () => {
    expect(validateDailyCap(20, "pro")).toEqual({ ok: true, value: 20 });
  });

  test("rejects non-integer", () => {
    const r = validateDailyCap(1.5, "pro");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("not_an_integer");
      expect(r.ceiling).toBe(5000);
    }
  });

  test("rejects zero", () => {
    const r = validateDailyCap(0, "pro");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_positive");
  });

  test("rejects negative", () => {
    const r = validateDailyCap(-10, "pro");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_positive");
  });

  test("rejects value above plan ceiling with ceiling in error", () => {
    const r = validateDailyCap(5001, "pro");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("exceeds_plan");
      expect(r.ceiling).toBe(5000);
    }
  });

  test("ceiling matches plan tier", () => {
    expect(validateDailyCap(500, "trial")).toEqual({ ok: true, value: 500 });
    expect(validateDailyCap(501, "trial").ok).toBe(false);
    expect(validateDailyCap(50000, "business")).toEqual({
      ok: true,
      value: 50000,
    });
    expect(validateDailyCap(50001, "business").ok).toBe(false);
  });
});
