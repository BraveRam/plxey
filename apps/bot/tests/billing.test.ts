import { describe, expect, test } from "bun:test";
import { _internals } from "../src/bots/billing";
import { CANCEL_REASONS } from "../src/lib/text";

const {
  parsePayload,
  parseCancelConfirmCallback,
  parseCancelReasonCallback,
  composeBillingScreen,
  planLabelFor,
  CB,
} = _internals;

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
            id: "sub-uuid-1",
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
    expect(CB.upgradeConfirm).toBe("billing_upgrade_confirm");
    expect(CB.cancel).toBe("billing_cancel");
    expect(CB.resume).toBe("billing_resume");
    expect(CB.cancelConfirmPrefix).toBe("billing_cancel_confirm_");
    expect(CB.cancelReasonPrefix).toBe("billing_cancel_reason_");
  });
});

// ---------------------------------------------------------------------------
// parseCancelConfirmCallback
// ---------------------------------------------------------------------------

describe("parseCancelConfirmCallback", () => {
  test("extracts a simple alphanumeric charge id", () => {
    expect(parseCancelConfirmCallback("billing_cancel_confirm_abc123")).toBe(
      "abc123",
    );
  });

  test("extracts a charge id that contains underscores", () => {
    // Telegram charge ids are opaque — preserve every character after the prefix.
    const id = "Stars_1234567890abcdef";
    expect(
      parseCancelConfirmCallback(`billing_cancel_confirm_${id}`),
    ).toBe(id);
  });

  test("extracts a charge id that contains dashes", () => {
    const id = "abc-def-ghi";
    expect(
      parseCancelConfirmCallback(`billing_cancel_confirm_${id}`),
    ).toBe(id);
  });

  test("returns null on prefix mismatch", () => {
    expect(parseCancelConfirmCallback("billing_cancel_abc")).toBeNull();
    expect(parseCancelConfirmCallback("billing_menu")).toBeNull();
  });

  test("returns null when charge id is empty", () => {
    expect(parseCancelConfirmCallback("billing_cancel_confirm_")).toBeNull();
  });

  test("returns null for undefined / non-string input", () => {
    expect(parseCancelConfirmCallback(undefined)).toBeNull();
    expect(parseCancelConfirmCallback("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseCancelReasonCallback
// ---------------------------------------------------------------------------

describe("parseCancelReasonCallback", () => {
  test("parses every shipped reason key against a simple charge id", () => {
    for (const reason of CANCEL_REASONS) {
      const data = `billing_cancel_reason_${reason.key}_charge42`;
      const parsed = parseCancelReasonCallback(data);
      expect(parsed).toEqual({ key: reason.key, subId: "charge42" });
    }
  });

  test("preserves charge ids that contain underscores", () => {
    const parsed = parseCancelReasonCallback(
      "billing_cancel_reason_too_expensive_Stars_42_abc",
    );
    expect(parsed).toEqual({
      key: "too_expensive",
      subId: "Stars_42_abc",
    });
  });

  test("returns null on unknown reason key", () => {
    expect(
      parseCancelReasonCallback("billing_cancel_reason_bogus_abc123"),
    ).toBeNull();
  });

  test("returns null when the reason key is present but the charge id is empty", () => {
    // "billing_cancel_reason_other_" — trailing underscore but no id.
    expect(
      parseCancelReasonCallback("billing_cancel_reason_other_"),
    ).toBeNull();
  });

  test("returns null on prefix mismatch", () => {
    expect(parseCancelReasonCallback("billing_cancel_other_abc")).toBeNull();
    expect(parseCancelReasonCallback("billing_menu")).toBeNull();
  });

  test("returns null for undefined / empty input", () => {
    expect(parseCancelReasonCallback(undefined)).toBeNull();
    expect(parseCancelReasonCallback("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// upgrade-confirm callback id is the static contract for the upgrade flow
// ---------------------------------------------------------------------------

describe("upgrade flow callback contract", () => {
  test("upgradeConfirm is a static (no-arg) callback id", () => {
    // The Business invoice link is minted server-side from the static
    // `billing_upgrade_confirm` callback; no chargeId is encoded into the
    // callback data because the upgrade flow operates on whichever Pro
    // subscription the owner currently holds.
    expect(CB.upgradeConfirm).toBe("billing_upgrade_confirm");
    // Sanity: no overlap with the cancel-confirm prefix that DOES carry an id.
    expect(CB.upgradeConfirm.startsWith(CB.cancelConfirmPrefix)).toBe(false);
  });
});
