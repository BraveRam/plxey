import { describe, expect, test } from "bun:test";
import type { EffectivePlanSubscription } from "../src/lib/plans";
import { PLANS, effectivePlan, planLimits } from "../src/lib/plans";

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
