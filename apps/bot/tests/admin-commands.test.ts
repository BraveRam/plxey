import { describe, expect, test } from "bun:test";
import type { Context } from "grammy";
import { __test } from "../src/bots/admin-commands";

const {
  isAdmin,
  formatSubscriptionLine,
  formatBotLine,
  renderOwnerSummary,
  parseOwnerIdArg,
} = __test;

describe("parseOwnerIdArg", () => {
  test("accepts a numeric id, trimmed", () => {
    expect(parseOwnerIdArg("123456789")).toBe("123456789");
    expect(parseOwnerIdArg("  123  ")).toBe("123");
  });

  test("rejects empty / missing", () => {
    expect(parseOwnerIdArg("")).toBeNull();
    expect(parseOwnerIdArg("   ")).toBeNull();
    expect(parseOwnerIdArg(undefined)).toBeNull();
  });

  test("rejects non-numeric (handles, partial digits, extra args)", () => {
    expect(parseOwnerIdArg("@alex")).toBeNull();
    expect(parseOwnerIdArg("12a")).toBeNull();
    expect(parseOwnerIdArg("123 456")).toBeNull();
  });
});

function makeCtx(fromId: number | undefined): Context {
  return {
    from: fromId === undefined ? undefined : { id: fromId },
  } as unknown as Context;
}

const NOW = new Date("2026-05-17T12:00:00.000Z");

describe("isAdmin", () => {
  test("false when ADMIN_TELEGRAM_USER_ID not set", () => {
    const prev = process.env.ADMIN_TELEGRAM_USER_ID;
    delete process.env.ADMIN_TELEGRAM_USER_ID;
    expect(isAdmin(makeCtx(123))).toBe(false);
    if (prev !== undefined) process.env.ADMIN_TELEGRAM_USER_ID = prev;
  });

  test("false when ctx.from missing", () => {
    process.env.ADMIN_TELEGRAM_USER_ID = "123";
    expect(isAdmin(makeCtx(undefined))).toBe(false);
  });

  test("false when caller id mismatches", () => {
    process.env.ADMIN_TELEGRAM_USER_ID = "123";
    expect(isAdmin(makeCtx(456))).toBe(false);
  });

  test("true when caller id matches", () => {
    process.env.ADMIN_TELEGRAM_USER_ID = "123";
    expect(isAdmin(makeCtx(123))).toBe(true);
  });
});

describe("formatSubscriptionLine", () => {
  test("non-comp row", () => {
    const line = formatSubscriptionLine({
      id: "abc",
      ownerTelegramUserId: "9",
      plan: "pro",
      status: "active",
      telegramPaymentChargeId: "ch_1",
      starsPerPeriod: 500,
      currentPeriodEnd: NOW,
      canceledAt: null,
      cancelReason: null,
      isComplimentary: false,
      createdAt: NOW,
    });
    expect(line).toBe("• pro — active — ends 2026-05-17");
  });

  test("comp row gets suffix", () => {
    const line = formatSubscriptionLine({
      id: "abc",
      ownerTelegramUserId: "9",
      plan: "business",
      status: "active",
      telegramPaymentChargeId: "comp:xxx",
      starsPerPeriod: 0,
      currentPeriodEnd: new Date("2099-12-31T23:59:59Z"),
      canceledAt: null,
      cancelReason: null,
      isComplimentary: true,
      createdAt: NOW,
    });
    expect(line).toBe("• business — active — ends 2099-12-31 (comp)");
  });
});

describe("formatBotLine", () => {
  test("active bot, no over-quota", () => {
    expect(
      formatBotLine({
        botUsername: "demo_bot",
        status: "active",
        overQuotaAt: null,
      }),
    ).toBe("• @demo_bot — active");
  });

  test("paused bot with over-quota flag", () => {
    expect(
      formatBotLine({
        botUsername: null,
        status: "paused",
        overQuotaAt: NOW,
      }),
    ).toBe("• (unknown) — paused 🚫over-quota");
  });
});

describe("renderOwnerSummary", () => {
  test("renders all blocks for a complete owner", () => {
    const out = renderOwnerSummary({
      owner: {
        telegramUserId: "12345",
        firstName: "Jane",
        lastName: null,
        username: "jane_doe",
        languageCode: null,
        isPremium: false,
        currentPlan: "pro",
        subscriptionStatus: "active",
        subscriptionRenewsAt: NOW,
        trialEndsAt: null,
        lifetimeStarsSpent: 1500,
        botCount: 2,
        docCount: 5,
        messagesThisPeriod: 12,
        periodStartedAt: NOW,
        lastActiveAt: NOW,
        firstSeenAt: NOW,
        updatedAt: NOW,
        notes: null,
        isBanned: false,
      },
      subs: [
        {
          id: "s1",
          ownerTelegramUserId: "12345",
          plan: "pro",
          status: "active",
          telegramPaymentChargeId: "ch_1",
          starsPerPeriod: 500,
          currentPeriodEnd: NOW,
          canceledAt: null,
          cancelReason: null,
          isComplimentary: false,
          createdAt: NOW,
        },
      ],
      bots: [
        { botUsername: "demo_bot", status: "active", overQuotaAt: null },
      ],
    });

    expect(out).toContain("12345");
    expect(out).toContain("@jane_doe");
    expect(out).toContain("Subscriptions:");
    expect(out).toContain("• pro — active");
    expect(out).toContain("Bots:");
    expect(out).toContain("@demo_bot");
    expect(out).not.toContain("BANNED");
  });

  test("appends BANNED line when isBanned=true", () => {
    const out = renderOwnerSummary({
      owner: {
        telegramUserId: "12345",
        firstName: null,
        lastName: null,
        username: null,
        languageCode: null,
        isPremium: false,
        currentPlan: null,
        subscriptionStatus: "lapsed",
        subscriptionRenewsAt: null,
        trialEndsAt: null,
        lifetimeStarsSpent: 0,
        botCount: 0,
        docCount: 0,
        messagesThisPeriod: 0,
        periodStartedAt: null,
        lastActiveAt: NOW,
        firstSeenAt: NOW,
        updatedAt: NOW,
        notes: null,
        isBanned: true,
      },
      subs: [],
      bots: [],
    });

    expect(out).toContain("Subscriptions: none");
    expect(out).toContain("Bots: none");
    expect(out).toContain("🚫 <b>BANNED</b>");
  });
});
