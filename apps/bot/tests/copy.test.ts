import { describe, expect, test } from "bun:test";
import {
  ANALYTICS_EMPTY_HINT,
  ONBOARDING_CREATE_PROMPT,
  ONBOARDING_HELP,
  TOAST_AUTOREAD_OFF,
  TOAST_AUTOREAD_ON,
  TOAST_STALE_CALLBACK,
  analyticsBucketScreen,
  analyticsLanding,
  analyticsWindowLabel,
  dailyCapButtonLabel,
  dailyCapUpdated,
  managementMenu,
  onboardingWelcome,
  tenantHelp,
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
      firstName: "Alex",
    });
    expect(out).toContain("<b>Hi Alex</b>");
    expect(out).toContain("Managing <b>@mybot</b>");
    expect(out).toContain("Status: ✅ Active");
    expect(out).toContain("Connection: ✅ Linked");
  });

  test("omits the greeting line when first name is missing", () => {
    const out = managementMenu({
      username: "mybot",
      statusIcon: "⏸ Paused",
      connectionLinked: false,
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
      firstName: null,
    });
    expect(out).toContain("Connection: ⏳ Not linked yet");
  });

  test("does not echo the system prompt", () => {
    // Owners already wrote their prompt; the menu shouldn't re-print it
    // every time they open settings. Regression guard against re-adding
    // a prompt preview field.
    const out = managementMenu({
      username: "mybot",
      statusIcon: "✅ Active",
      connectionLinked: true,
      firstName: "Alex",
    });
    expect(out).not.toContain("Prompt preview");
  });

  test("does not run a document COUNT(*) on the hot /start path", () => {
    // Regression guard: the header was previously echoing a doc count
    // line, which required an extra DB COUNT(*) on every owner /start.
    // We dropped it — knowledge size is one tap away via 📚 Knowledge.
    const out = managementMenu({
      username: "mybot",
      statusIcon: "✅ Active",
      connectionLinked: true,
      firstName: "Alex",
    });
    expect(out).not.toContain("Knowledge:");
    expect(out).not.toContain("documents");
  });

  test("escapes HTML in dynamic fields to prevent parse errors", () => {
    const out = managementMenu({
      username: "<bad>",
      statusIcon: "✅ Active",
      connectionLinked: true,
      firstName: "A<lex>",
    });
    expect(out).toContain("@&lt;bad&gt;");
    expect(out).toContain("A&lt;lex&gt;");
  });
});

describe("ONBOARDING_CREATE_PROMPT", () => {
  test("walks the owner through the three concrete BotFather steps", () => {
    expect(ONBOARDING_CREATE_PROMPT).toContain("/newbot");
    expect(ONBOARDING_CREATE_PROMPT).toContain("/mybots");
    expect(ONBOARDING_CREATE_PROMPT).toContain("Business Mode");
    expect(ONBOARDING_CREATE_PROMPT).toContain("Paste the token");
  });

  test("warns the owner about token secrecy and how to revoke", () => {
    expect(ONBOARDING_CREATE_PROMPT).toContain("Keep the token private");
    expect(ONBOARDING_CREATE_PROMPT).toContain("/revoke");
  });

  test("hints at the post-connect step (Business account linking)", () => {
    expect(ONBOARDING_CREATE_PROMPT).toContain("Telegram Business account");
  });

  test("renders as HTML (caller must send with parse_mode: HTML)", () => {
    expect(ONBOARDING_CREATE_PROMPT).toContain("<b>");
    expect(ONBOARDING_CREATE_PROMPT).toContain("<code>");
  });
});

describe("ONBOARDING_HELP", () => {
  test("covers the three main-menu buttons", () => {
    expect(ONBOARDING_HELP).toContain("🤖 New bot");
    expect(ONBOARDING_HELP).toContain("⚙️ Your bots");
    expect(ONBOARDING_HELP).toContain("💳 Billing");
  });

  test("references BotFather and Business Mode setup", () => {
    expect(ONBOARDING_HELP).toContain("@BotFather");
    expect(ONBOARDING_HELP).toContain("Business Mode");
    expect(ONBOARDING_HELP).toContain("Reply to messages");
  });

  test("lists the three shipped slash commands", () => {
    expect(ONBOARDING_HELP).toContain("<code>/start</code>");
    expect(ONBOARDING_HELP).toContain("<code>/billing</code>");
    expect(ONBOARDING_HELP).toContain("<code>/help</code>");
  });
});

describe("tenantHelp", () => {
  test("addresses the bot by @username", () => {
    expect(tenantHelp({ username: "supportbot" })).toContain(
      "<b>Managing @supportbot</b>",
    );
  });

  test("explains every management-menu button", () => {
    const out = tenantHelp({ username: "supportbot" });
    expect(out).toContain("✏️ Prompt");
    expect(out).toContain("💬 Welcome");
    expect(out).toContain("📚 Knowledge");
    expect(out).toContain("🎯 Daily limit");
    expect(out).toContain("✉️ Edit busy reply");
    expect(out).toContain("👁 Auto-read");
    expect(out).toContain("🔒 Permissions");
    expect(out).toContain("📊 Analytics");
  });

  test("describes the human-reply escalation flow", () => {
    expect(tenantHelp({ username: "supportbot" })).toContain("✏️ Reply");
  });

  test("escapes HTML in the username", () => {
    expect(tenantHelp({ username: "<bad>" })).toContain("@&lt;bad&gt;");
  });
});

describe("analyticsWindowLabel", () => {
  test("maps each window enum to its display label", () => {
    expect(analyticsWindowLabel("today")).toBe("Today");
    expect(analyticsWindowLabel("last7d")).toBe("Last 7 days");
    expect(analyticsWindowLabel("last30d")).toBe("Last 30 days");
  });
});

describe("analyticsLanding", () => {
  test("renders header with bot username (HTML-escaped) and the picker prompt", () => {
    const out = analyticsLanding({
      username: "<evil>",
      hasAnyActivity: true,
    });
    expect(out).toContain("📊 <b>Analytics — @&lt;evil&gt;</b>");
    expect(out).toContain("Pick a window");
  });

  test("renders the empty hint when there's never been a customer message", () => {
    const out = analyticsLanding({
      username: "supportbot",
      hasAnyActivity: false,
    });
    expect(out).toContain("📊 <b>Analytics — @supportbot</b>");
    expect(out).toContain(ANALYTICS_EMPTY_HINT);
    expect(out).not.toContain("Pick a window");
  });
});

describe("analyticsBucketScreen", () => {
  const NOW = new Date("2026-05-18T12:00:00.000Z");
  const sample = { received: 124, answered: 98, customers: 18 };

  test("renders the window label in the header", () => {
    const out = analyticsBucketScreen({
      username: "supportbot",
      window: "today",
      bucket: sample,
      lastMessageAt: new Date("2026-05-18T11:56:00.000Z"),
      now: NOW,
    });
    expect(out).toContain("📊 <b>Today — @supportbot</b>");
  });

  test("renders the three numbers", () => {
    const out = analyticsBucketScreen({
      username: "supportbot",
      window: "last7d",
      bucket: { received: 812, answered: 692, customers: 47 },
      lastMessageAt: new Date("2026-05-18T11:56:00.000Z"),
      now: NOW,
    });
    expect(out).toContain("📊 <b>Last 7 days — @supportbot</b>");
    expect(out).toContain("Messages received:  812");
    expect(out).toContain("AI replies sent:    692");
    expect(out).toContain("Unique customers:   47");
  });

  test("only renders one bucket — not all three", () => {
    const out = analyticsBucketScreen({
      username: "supportbot",
      window: "today",
      bucket: sample,
      lastMessageAt: null,
      now: NOW,
    });
    expect(out).not.toContain("Last 7 days");
    expect(out).not.toContain("Last 30 days");
  });

  test("renders the relative-time line for the last customer message", () => {
    const out = analyticsBucketScreen({
      username: "supportbot",
      window: "today",
      bucket: sample,
      lastMessageAt: new Date("2026-05-18T11:56:00.000Z"),
      now: NOW,
    });
    expect(out).toContain("Last message: 4 minutes ago");
  });

  test("renders an em-dash when lastMessageAt is null", () => {
    const out = analyticsBucketScreen({
      username: "supportbot",
      window: "today",
      bucket: { received: 0, answered: 0, customers: 0 },
      lastMessageAt: null,
      now: NOW,
    });
    expect(out).toContain("Last message: —");
  });

  test("HTML-escapes the bot username", () => {
    const out = analyticsBucketScreen({
      username: "<evil>",
      window: "last30d",
      bucket: sample,
      lastMessageAt: null,
      now: NOW,
    });
    expect(out).toContain("@&lt;evil&gt;");
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
