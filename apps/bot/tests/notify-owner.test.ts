import { describe, expect, test } from "bun:test";
import { __test } from "../src/inngest/handlers/notify-owner";
import { PLANS } from "../src/lib/plans";

const { buildText, buildDmKeyboard, dedupSuffix, miniappBillingUrl } = __test;

/**
 * Per-kind contract: every NotifyOwnerKind that should ship buttons gets
 * keyboards whose `callback_data` values match the literals
 * `apps/bot/src/bots/billing.ts` registers via `bot.callbackQuery(CB.*)`.
 * Drift here = silently broken DM CTAs in prod.
 */

const CB_SUBSCRIBE_PRO = "billing_subscribe_pro";
const CB_SUBSCRIBE_BUSINESS = "billing_subscribe_business";
const CB_UPGRADE_BUSINESS = "billing_upgrade_business";
const CB_RESUME = "billing_resume";

function callbackValues(
  kb: ReturnType<typeof buildDmKeyboard>,
): string[] {
  if (!kb) return [];
  return kb.inline_keyboard
    .flat()
    .map((b) => ("callback_data" in b ? b.callback_data : `url:${b.url}`));
}

describe("buildText — lifecycle DM copy", () => {
  test("trial_started includes pricing line + consequence framing", () => {
    const text = buildText("trial_started", undefined);
    expect(text).not.toBeNull();
    expect(text).toContain("Trial started");
    expect(text).toContain(`${PLANS.pro.starsPerPeriod}⭐`);
    expect(text).toContain(`${PLANS.business.starsPerPeriod}⭐`);
  });

  test("trial_ending_3d / trial_ending_1d include pricing", () => {
    for (const kind of ["trial_ending_3d", "trial_ending_1d"] as const) {
      const text = buildText(kind, undefined);
      expect(text).toContain(`${PLANS.pro.starsPerPeriod}⭐`);
      expect(text).toContain(`${PLANS.business.starsPerPeriod}⭐`);
    }
  });

  test("trial_expired surfaces consequence + pricing", () => {
    const text = buildText("trial_expired", undefined);
    expect(text).toContain("paused");
    expect(text).toContain(`${PLANS.pro.starsPerPeriod}⭐`);
  });

  test("subscription_lapsed includes plan label, bot count, pricing", () => {
    const text = buildText("subscription_lapsed", { plan: "pro", bots: 2 });
    expect(text).toContain("Pro");
    expect(text).toContain("2 bots paused");
    expect(text).toContain(`${PLANS.business.starsPerPeriod}⭐`);
  });

  test("quota_messages_exceeded shows cap and plan", () => {
    const text = buildText("quota_messages_exceeded", {
      cap: 5000,
      plan: "pro",
    });
    expect(text).toContain("5,000 messages");
    expect(text).toContain("Pro");
    expect(text).toContain(`${PLANS.business.starsPerPeriod}⭐`);
  });

  test("subscription_canceled offers resume CTA copy", () => {
    const text = buildText("subscription_canceled", {
      plan: "pro",
      endsAt: "2026-06-01T00:00:00.000Z",
    });
    expect(text).toContain("Pro");
    expect(text).toContain("2026-06-01");
    expect(text?.toLowerCase()).toContain("resume");
  });

  test("cancel_3d_before_end copy + button are now coherent", () => {
    const text = buildText("cancel_3d_before_end", {
      plan: "business",
      endsAt: "2026-06-04T00:00:00.000Z",
    });
    // Copy was previously buttonless but said "Resume … below". The fix
    // is "copy says below AND a button is actually attached" — not just
    // editing the copy. Assert both halves of that contract.
    expect(text).toContain("below");
    const kb = buildDmKeyboard("cancel_3d_before_end", undefined);
    expect(callbackValues(kb)).toEqual(["billing_resume"]);
  });

  test("recovery_t3 mentions docs when present", () => {
    const withDocs = buildText("recovery_t3", { docs: 5 });
    expect(withDocs).toContain("5 documents");
    const zero = buildText("recovery_t3", { docs: 0 });
    expect(zero).not.toContain("0 documents");
  });

  test("recovery_t14 is the longer-form recovery DM", () => {
    const text = buildText("recovery_t14", undefined);
    expect(text).toContain("two weeks");
    expect(text).toContain(`${PLANS.pro.starsPerPeriod}⭐`);
  });

  test("pausedBotCustomerPing references the username", () => {
    const text = buildText("customer_msg_to_paused_bot", {
      botUsername: "examplebot",
    });
    expect(text).toContain("@examplebot");
  });
});

describe("buildDmKeyboard — per-kind button matrix", () => {
  test("trial CTAs all show Pro + Business callback buttons", () => {
    for (const kind of [
      "trial_ending_3d",
      "trial_ending_1d",
      "trial_expired",
      "subscription_lapsed",
      "recovery_t3",
      "recovery_t14",
    ] as const) {
      const kb = buildDmKeyboard(kind, undefined);
      expect(callbackValues(kb)).toEqual([
        CB_SUBSCRIBE_PRO,
        CB_SUBSCRIBE_BUSINESS,
      ]);
    }
  });

  test("trial_started adds Mini App URL when bot username known", () => {
    const kb = buildDmKeyboard("trial_started", undefined);
    const flat = callbackValues(kb);
    expect(flat).toContain(CB_SUBSCRIBE_PRO);
    expect(flat).toContain(CB_SUBSCRIBE_BUSINESS);
    // Mini App URL only when bot identity resolved; in unit tests it's null.
    expect(miniappBillingUrl()).toBeNull();
  });

  test("cancel-side DMs offer Resume callback", () => {
    for (const kind of ["cancel_3d_before_end", "subscription_canceled"] as const) {
      const kb = buildDmKeyboard(kind, undefined);
      expect(callbackValues(kb)).toEqual([CB_RESUME]);
    }
  });

  test("subscription_started: Pro shows upgrade button", () => {
    const kb = buildDmKeyboard("subscription_started", { plan: "pro" });
    expect(callbackValues(kb)).toContain(CB_UPGRADE_BUSINESS);
  });

  test("subscription_started: Business has no upgrade", () => {
    const kb = buildDmKeyboard("subscription_started", { plan: "business" });
    expect(callbackValues(kb)).not.toContain(CB_UPGRADE_BUSINESS);
  });

  test("quota_messages_exceeded: Pro offers upgrade; Business is informational", () => {
    const pro = buildDmKeyboard("quota_messages_exceeded", { plan: "pro" });
    expect(callbackValues(pro)).toEqual([CB_UPGRADE_BUSINESS]);
    const business = buildDmKeyboard("quota_messages_exceeded", {
      plan: "business",
    });
    expect(business).toBeUndefined();
  });

  test("customer_msg_to_paused_bot falls back to subscribe buttons when no invoice URL", () => {
    const kb = buildDmKeyboard("customer_msg_to_paused_bot", { plan: "pro" });
    expect(callbackValues(kb)).toEqual([
      CB_SUBSCRIBE_PRO,
      CB_SUBSCRIBE_BUSINESS,
    ]);
  });

  test("customer_msg_to_paused_bot uses the URL invoice when provided", () => {
    const kb = buildDmKeyboard("customer_msg_to_paused_bot", {
      plan: "pro",
      invoiceUrl: "https://t.me/$invoice123",
    });
    const buttons = kb?.inline_keyboard.flat() ?? [];
    expect(buttons).toHaveLength(1);
    const button = buttons[0]!;
    expect("url" in button).toBe(true);
    if ("url" in button) {
      expect(button.url).toBe("https://t.me/$invoice123");
      expect(button.text).toContain(`${PLANS.pro.starsPerPeriod}`);
    }
  });

  test("admin_event_summary stays buttonless", () => {
    const kb = buildDmKeyboard("admin_event_summary", undefined);
    expect(kb).toBeUndefined();
  });

  test("button labels reflect current PLANS prices", () => {
    const kb = buildDmKeyboard("subscription_lapsed", undefined);
    const labels = kb!.inline_keyboard.flat().map((b) => b.text);
    expect(labels.some((l) => l.includes(`${PLANS.pro.starsPerPeriod}`))).toBe(
      true,
    );
    expect(
      labels.some((l) => l.includes(`${PLANS.business.starsPerPeriod}`)),
    ).toBe(true);
  });
});

describe("dedupSuffix — recovery kinds bucket per lapse date", () => {
  test("recovery_t3 bucket changes when lapsedAt shifts", () => {
    const a = dedupSuffix("recovery_t3", { lapsedAt: "2026-05-01T00:00:00.000Z" });
    const b = dedupSuffix("recovery_t3", { lapsedAt: "2026-05-02T00:00:00.000Z" });
    expect(a).not.toBe(b);
    expect(a.startsWith("recovery3:")).toBe(true);
  });

  test("recovery_t14 has its own bucket distinct from recovery_t3", () => {
    const t3 = dedupSuffix("recovery_t3", { lapsedAt: "2026-05-01T00:00:00.000Z" });
    const t14 = dedupSuffix("recovery_t14", { lapsedAt: "2026-05-01T00:00:00.000Z" });
    expect(t3).not.toBe(t14);
  });
});
