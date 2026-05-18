import { describe, expect, test } from "bun:test";
import {
  TOAST_AUTOREAD_OFF,
  TOAST_AUTOREAD_ON,
  TOAST_STALE_CALLBACK,
  dailyCapButtonLabel,
  dailyCapUpdated,
  onboardingWelcome,
  truncateMid,
} from "../src/lib/text";

describe("daily limit button label", () => {
  test("uses target emoji and 'Daily limit' wording", () => {
    expect(dailyCapButtonLabel(null)).toBe("🎯 Daily limit: Off");
    expect(dailyCapButtonLabel(50)).toBe("🎯 Daily limit: 50");
  });

  test("stays within the 22-char visual budget at Business plan ceiling", () => {
    // 50000 is the Business plan's monthly cap = the largest legitimate
    // value the owner can configure. Telegram clips inline-button text
    // at ~24 chars visually; we aim for ≤22 to leave breathing room.
    const label = dailyCapButtonLabel(50000);
    expect([...label].length).toBeLessThanOrEqual(22);
  });

  test("uses sentence-case 'Off' (not 'OFF')", () => {
    expect(dailyCapButtonLabel(null)).toContain("Off");
    expect(dailyCapButtonLabel(null)).not.toContain("OFF");
  });
});

describe("daily limit success copy", () => {
  test("uses ✅ confirmation pattern, not the old 🚦", () => {
    expect(dailyCapUpdated(null)).toBe("✅ Daily limit removed.");
    expect(dailyCapUpdated(50)).toBe(
      "✅ Daily limit set to 50 replies per customer per day.",
    );
  });
});

describe("auto-read toasts", () => {
  test("are sentence-case (no ON/OFF)", () => {
    expect(TOAST_AUTOREAD_ON.startsWith("Auto-read on.")).toBe(true);
    expect(TOAST_AUTOREAD_OFF.startsWith("Auto-read off.")).toBe(true);
  });

  test("describe the consequence in plain prose", () => {
    expect(TOAST_AUTOREAD_ON).toContain("show as read");
    expect(TOAST_AUTOREAD_OFF).toContain("stay unread");
  });
});

describe("stale-callback toast", () => {
  test("is a friendly sentence, not jargon", () => {
    expect(TOAST_STALE_CALLBACK).toBe(
      "That button expired. Reopened the menu.",
    );
  });
});

describe("onboardingWelcome", () => {
  test("addresses the owner by first name when available", () => {
    const out = onboardingWelcome("Alex");
    expect(out).toContain("Welcome, Alex");
    expect(out.startsWith("<b>")).toBe(true);
  });

  test("falls back to a neutral greeting when first name is missing", () => {
    expect(onboardingWelcome(null)).toContain("👋 Welcome</b>");
    expect(onboardingWelcome("")).toContain("👋 Welcome</b>");
    expect(onboardingWelcome("   ")).toContain("👋 Welcome</b>");
  });

  test("includes the call-to-action prompt", () => {
    expect(onboardingWelcome("Alex")).toContain(
      "Choose an option below to get started.",
    );
  });
});

describe("truncateMid", () => {
  test("returns the input unchanged when within budget", () => {
    expect(truncateMid("hello", 10)).toBe("hello");
    expect(truncateMid("exactlyTen", 10)).toBe("exactlyTen");
  });

  test("appends a single ellipsis when over budget", () => {
    // total length stays at `max`; last char is the ellipsis.
    const out = truncateMid("quarterly_financial_statements_for_2024.pdf", 25);
    expect(out.length).toBe(25);
    expect(out.endsWith("…")).toBe(true);
  });

  test("does not exceed the budget", () => {
    expect(truncateMid("a".repeat(1000), 8).length).toBe(8);
  });
});
