import { describe, expect, test } from "bun:test";
import { _internals } from "../src/bots/billing";

const { parsePayload, composeBillingScreen, planLabelFor, CB } = _internals;

describe("parsePayload", () => {
  test("parses a happy-path pro payload", () => {
    const out = parsePayload("sub:123456:pro:0123456789abcdef");
    expect(out).toEqual({
      ownerId: "123456",
      plan: "pro",
      nonce: "0123456789abcdef",
    });
  });

  test("parses a happy-path business payload", () => {
    const out = parsePayload("sub:987:business:deadbeefcafebabe");
    expect(out).toEqual({
      ownerId: "987",
      plan: "business",
      nonce: "deadbeefcafebabe",
    });
  });

  test("rejects payload with wrong prefix", () => {
    expect(parsePayload("foo:123:pro:0123456789abcdef")).toBeNull();
  });

  test("rejects payload with too few fields", () => {
    expect(parsePayload("sub:123:pro")).toBeNull();
  });

  test("rejects payload with too many fields", () => {
    expect(parsePayload("sub:123:pro:abc:extra")).toBeNull();
  });

  test("rejects trial plan (only pro|business are purchasable)", () => {
    expect(parsePayload("sub:123:trial:0123456789abcdef")).toBeNull();
  });

  test("rejects free plan", () => {
    expect(parsePayload("sub:123:free:0123456789abcdef")).toBeNull();
  });

  test("rejects unknown plan", () => {
    expect(parsePayload("sub:123:enterprise:0123456789abcdef")).toBeNull();
  });

  test("rejects empty ownerId", () => {
    expect(parsePayload("sub::pro:0123456789abcdef")).toBeNull();
  });

  test("rejects non-hex nonce", () => {
    expect(parsePayload("sub:123:pro:ZZZZZZZZZZZZZZZZ")).toBeNull();
  });

  test("rejects nonce that is too short", () => {
    expect(parsePayload("sub:123:pro:0123abcd")).toBeNull();
  });

  test("rejects nonce that is too long", () => {
    expect(parsePayload("sub:123:pro:0123456789abcdef00")).toBeNull();
  });

  test("rejects uppercase hex nonce (we mint lowercase)", () => {
    expect(parsePayload("sub:123:pro:0123456789ABCDEF")).toBeNull();
  });

  test("rejects empty string", () => {
    expect(parsePayload("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// composeBillingScreen
// ---------------------------------------------------------------------------

type BillingState = Parameters<typeof composeBillingScreen>[0];

function stateFactory(overrides: Partial<BillingState> = {}): BillingState {
  return {
    ownerId: "u1",
    status: "trialing",
    effectivePlan: null,
    trialEndsAt: null,
    subscriptionRenewsAt: null,
    botCount: 0,
    largestBotDocCount: 0,
    messagesThisPeriod: 0,
    subs: [],
    ...overrides,
  } as BillingState;
}

describe("composeBillingScreen", () => {
  test("renders trial header with days-left + plan picker", () => {
    const fiveDays = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const out = composeBillingScreen(
      stateFactory({
        status: "trialing",
        trialEndsAt: fiveDays,
        botCount: 1,
        largestBotDocCount: 2,
        messagesThisPeriod: 42,
      }),
    );
    expect(out).toContain("🎫 Trial:");
    expect(out).toContain("days left");
    expect(out).toContain("Usage this period:");
    expect(out).toContain("Bots: 1/1");
    expect(out).toContain("Documents (largest bot): 2/3");
    expect(out).toContain("Messages: 42/500");
    expect(out).toContain("⭐ Choose your plan:");
    expect(out).toContain("Pro");
    expect(out).toContain("Business");
  });

  test("renders active Pro header with renewal date", () => {
    const renews = new Date("2026-06-15T00:00:00.000Z");
    const out = composeBillingScreen(
      stateFactory({
        status: "active",
        effectivePlan: "pro",
        subscriptionRenewsAt: renews,
        botCount: 2,
        largestBotDocCount: 7,
        messagesThisPeriod: 234,
      }),
    );
    expect(out).toContain("<b>Pro</b> — active");
    expect(out).toContain("Renews on");
    expect(out).toContain("Usage this period:");
    expect(out).toContain("Bots: 2/3");
    expect(out).toContain("Documents (largest bot): 7/10");
    expect(out).toContain("Messages: 234/5,000");
    // Active screens do NOT show the plan picker.
    expect(out).not.toContain("⭐ Choose your plan:");
  });

  test("renders active Business header", () => {
    const out = composeBillingScreen(
      stateFactory({
        status: "active",
        effectivePlan: "business",
        subscriptionRenewsAt: new Date("2026-06-15T00:00:00.000Z"),
        botCount: 5,
        largestBotDocCount: 12,
        messagesThisPeriod: 999,
      }),
    );
    expect(out).toContain("<b>Business</b> — active");
    expect(out).toContain("Bots: 5/10");
    expect(out).toContain("Documents (largest bot): 12/50");
    expect(out).toContain("Messages: 999/50,000");
  });

  test("renders canceled state with tail end date", () => {
    const tailEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const out = composeBillingScreen(
      stateFactory({
        status: "canceled",
        effectivePlan: "pro",
        subs: [
          {
            plan: "pro",
            status: "canceled",
            currentPeriodEnd: tailEnd,
            telegramPaymentChargeId: "c1",
          },
        ],
        botCount: 1,
        largestBotDocCount: 0,
        messagesThisPeriod: 0,
      }),
    );
    expect(out).toContain("<b>Pro</b> — canceled");
    expect(out).toContain("Ends on");
  });

  test("renders lapsed state with the plan picker", () => {
    const out = composeBillingScreen(
      stateFactory({
        status: "lapsed",
        effectivePlan: null,
      }),
    );
    expect(out).toContain("🚫 No active plan");
    expect(out).toContain("⭐ Choose your plan:");
    expect(out).toContain("Pro");
    expect(out).toContain("Business");
  });
});

// ---------------------------------------------------------------------------
// planLabelFor / CB
// ---------------------------------------------------------------------------

describe("planLabelFor", () => {
  test("renders the user-facing plan labels", () => {
    expect(planLabelFor("trial")).toBe("Trial");
    expect(planLabelFor("pro")).toBe("Pro");
    expect(planLabelFor("business")).toBe("Business");
  });
});

describe("callback data ids", () => {
  test("exposes the contract names the onboarding bot mounts", () => {
    expect(CB.menu).toBe("billing_menu");
    expect(CB.subscribePro).toBe("billing_subscribe_pro");
    expect(CB.subscribeBusiness).toBe("billing_subscribe_business");
    expect(CB.upgradeBusiness).toBe("billing_upgrade_business");
    expect(CB.cancel).toBe("billing_cancel");
    expect(CB.resume).toBe("billing_resume");
  });
});
