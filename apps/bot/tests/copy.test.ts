import { describe, expect, test } from "bun:test";
import {
  TOAST_AUTOREAD_OFF,
  TOAST_AUTOREAD_ON,
  TOAST_STALE_CALLBACK,
  dailyCapButtonLabel,
  dailyCapUpdated,
  managementMenu,
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

describe("managementMenu", () => {
  test("greets the owner by first name in bold when available", () => {
    const out = managementMenu({
      username: "mybot",
      statusIcon: "✅ Active",
      connectionLinked: true,
      documentCount: 5,
      firstName: "Alex",
    });
    expect(out).toContain("<b>Hi Alex</b>");
    expect(out).toContain("Managing <b>@mybot</b>");
    expect(out).toContain("Status: ✅ Active");
    expect(out).toContain("Connection: ✅ Linked");
    expect(out).toContain("Knowledge: 5 documents");
  });

  test("omits the greeting line when first name is missing", () => {
    const out = managementMenu({
      username: "mybot",
      statusIcon: "⏸ Paused",
      connectionLinked: false,
      documentCount: 0,
      firstName: null,
    });
    expect(out).not.toContain("Hi ");
    expect(out.startsWith("Managing <b>@mybot</b>")).toBe(true);
  });

  test("shows the pending-connection state when not yet linked", () => {
    const out = managementMenu({
      username: "mybot",
      statusIcon: "✅ Active",
      connectionLinked: false,
      documentCount: 0,
      firstName: null,
    });
    expect(out).toContain("Connection: ⏳ Not linked yet");
  });

  test("pluralizes the document word correctly", () => {
    const one = managementMenu({
      username: "mybot",
      statusIcon: "✅ Active",
      connectionLinked: true,
      documentCount: 1,
      firstName: null,
    });
    expect(one).toContain("Knowledge: 1 document");
    expect(one).not.toContain("documents");

    const zero = managementMenu({
      username: "mybot",
      statusIcon: "✅ Active",
      connectionLinked: true,
      documentCount: 0,
      firstName: null,
    });
    expect(zero).toContain("Knowledge: 0 documents");
  });

  test("does not echo the system prompt", () => {
    // Owners already wrote their prompt; the menu shouldn't re-print it
    // every time they open settings. Regression guard against re-adding
    // a prompt preview field.
    const out = managementMenu({
      username: "mybot",
      statusIcon: "✅ Active",
      connectionLinked: true,
      documentCount: 5,
      firstName: "Alex",
    });
    expect(out).not.toContain("Prompt preview");
  });

  test("escapes HTML in dynamic fields to prevent parse errors", () => {
    const out = managementMenu({
      username: "<bad>",
      statusIcon: "✅ Active",
      connectionLinked: true,
      documentCount: 1,
      firstName: "A<lex>",
    });
    expect(out).toContain("@&lt;bad&gt;");
    expect(out).toContain("A&lt;lex&gt;");
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
