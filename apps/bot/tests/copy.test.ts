import { describe, expect, test } from "bun:test";
import {
  ANALYTICS_EMPTY_HINT,
  ONBOARDING_CREATE_PROMPT,
  ONBOARDING_HELP,
  PRIVACY_POLICY,
  TERMS_OF_SERVICE,
  TOAST_AUTOREAD_OFF,
  TOAST_AUTOREAD_ON,
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
      statusIcon: "✅ Active",
      connectionLinked: true,
      firstName: "Alex",
    });
    expect(out).toContain("<b>Hi Alex</b>");
    expect(out).toContain("<b>Manage your bot</b>");
    expect(out).toContain("Status: ✅ Active");
    expect(out).toContain("Connection: ✅ Linked");
  });

  test("omits the greeting line when first name is missing", () => {
    const out = managementMenu({
      statusIcon: "⏸ Paused",
      connectionLinked: false,
      firstName: null,
    });
    expect(out).not.toContain("Hi ");
    expect(out.startsWith("<b>Manage your bot</b>")).toBe(true);
  });

  test("shows the pending-connection state when not yet linked", () => {
    const out = managementMenu({
      statusIcon: "✅ Active",
      connectionLinked: false,
      firstName: null,
    });
    expect(out).toContain("Connection: ⏳ Not linked yet");
  });

  test("does not echo the bot @username (owner is already in the bot)", () => {
    // Regression guard: previous versions rendered "Managing
    // @{botUsername}" which is redundant inside the bot's own chat.
    const out = managementMenu({
      statusIcon: "✅ Active",
      connectionLinked: true,
      firstName: "Alex",
    });
    expect(out).not.toContain("@");
  });

  test("does not echo the system prompt", () => {
    // Owners already wrote their prompt; the menu shouldn't re-print it
    // every time they open settings. Regression guard against re-adding
    // a prompt preview field.
    const out = managementMenu({
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
      statusIcon: "✅ Active",
      connectionLinked: true,
      firstName: "Alex",
    });
    expect(out).not.toContain("Knowledge:");
    expect(out).not.toContain("documents");
  });

  test("escapes HTML in the first-name greeting", () => {
    const out = managementMenu({
      statusIcon: "✅ Active",
      connectionLinked: true,
      firstName: "A<lex>",
    });
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

  test("lists the five shipped slash commands", () => {
    expect(ONBOARDING_HELP).toContain("<code>/start</code>");
    expect(ONBOARDING_HELP).toContain("<code>/billing</code>");
    expect(ONBOARDING_HELP).toContain("<code>/help</code>");
    expect(ONBOARDING_HELP).toContain("<code>/privacy</code>");
    expect(ONBOARDING_HELP).toContain("<code>/terms</code>");
  });
});

describe("PRIVACY_POLICY", () => {
  test("opens with a bold header", () => {
    expect(PRIVACY_POLICY.startsWith("<b>Privacy policy</b>")).toBe(true);
  });

  test("covers every section we promise owners", () => {
    expect(PRIVACY_POLICY).toContain("What we know about you");
    expect(PRIVACY_POLICY).toContain("What we use it for");
    expect(PRIVACY_POLICY).toContain("Who we share it with");
    expect(PRIVACY_POLICY).toContain("How long we keep it");
    expect(PRIVACY_POLICY).toContain("Your choices");
    expect(PRIVACY_POLICY).toContain("Questions or requests");
  });

  test("uses owner-friendly language — no infra jargon", () => {
    // Quick regression guard against the tech-laden draft. None of
    // these should leak into the customer-facing copy.
    const lower = PRIVACY_POLICY.toLowerCase();
    expect(lower).not.toContain("aes-gcm");
    expect(lower).not.toContain("postgres");
    expect(lower).not.toContain("neon");
    expect(lower).not.toContain("upstash");
    expect(lower).not.toContain("backblaze");
    expect(lower).not.toContain("posthog");
    expect(lower).not.toContain("inngest");
    expect(lower).not.toContain("koyeb");
    expect(lower).not.toContain("vercel");
    // (skip "rag" as a substring guard — false positive against "stoRAGe")
  });

  test("mentions Telegram Stars for payments", () => {
    expect(PRIVACY_POLICY).toContain("Telegram Stars");
  });
});

describe("TERMS_OF_SERVICE", () => {
  test("opens with a bold header", () => {
    expect(TERMS_OF_SERVICE.startsWith("<b>Terms of service</b>")).toBe(true);
  });

  test("covers the must-have sections", () => {
    expect(TERMS_OF_SERVICE).toContain("Subscription and payments");
    expect(TERMS_OF_SERVICE).toContain("What you can and can't do");
    expect(TERMS_OF_SERVICE).toContain("About the AI replies");
    expect(TERMS_OF_SERVICE).toContain("Service is");
    expect(TERMS_OF_SERVICE).toContain("Changes to these terms");
  });

  test("mentions /billing as the cancellation path", () => {
    expect(TERMS_OF_SERVICE).toContain("/billing");
  });

  test("uses owner-friendly language", () => {
    const lower = TERMS_OF_SERVICE.toLowerCase();
    expect(lower).not.toContain("aes-gcm");
    expect(lower).not.toContain("postgres");
    expect(lower).not.toContain("vercel");
    expect(lower).not.toContain("inngest");
  });
});

describe("tenantHelp", () => {
  test("uses a generic 'Bot help' header — no @username", () => {
    const out = tenantHelp();
    expect(out).toContain("<b>Bot help</b>");
    expect(out).not.toContain("@");
  });

  test("explains every management-menu button", () => {
    const out = tenantHelp();
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
    expect(tenantHelp()).toContain("✏️ Reply");
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
  test("renders the generic Analytics header and the picker prompt", () => {
    const out = analyticsLanding({ hasAnyActivity: true });
    expect(out).toContain("📊 <b>Analytics</b>");
    expect(out).toContain("Pick a window");
  });

  test("renders the empty hint when there's never been a customer message", () => {
    const out = analyticsLanding({ hasAnyActivity: false });
    expect(out).toContain("📊 <b>Analytics</b>");
    expect(out).toContain(ANALYTICS_EMPTY_HINT);
    expect(out).not.toContain("Pick a window");
  });

  test("does not echo the bot @username", () => {
    expect(analyticsLanding({ hasAnyActivity: true })).not.toContain("@");
    expect(analyticsLanding({ hasAnyActivity: false })).not.toContain("@");
  });
});

describe("analyticsBucketScreen", () => {
  const NOW = new Date("2026-05-18T12:00:00.000Z");
  const sample = { received: 124, answered: 98, customers: 18 };

  test("renders the window label in the header — no @username", () => {
    const out = analyticsBucketScreen({
      window: "today",
      bucket: sample,
      lastMessageAt: new Date("2026-05-18T11:56:00.000Z"),
      now: NOW,
    });
    expect(out).toContain("📊 <b>Today</b>");
    expect(out).not.toContain("@");
  });

  test("renders the three numbers", () => {
    const out = analyticsBucketScreen({
      window: "last7d",
      bucket: { received: 812, answered: 692, customers: 47 },
      lastMessageAt: new Date("2026-05-18T11:56:00.000Z"),
      now: NOW,
    });
    expect(out).toContain("📊 <b>Last 7 days</b>");
    expect(out).toContain("Messages received:  812");
    expect(out).toContain("AI replies sent:    692");
    expect(out).toContain("Unique customers:   47");
  });

  test("only renders one bucket — not all three", () => {
    const out = analyticsBucketScreen({
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
      window: "today",
      bucket: sample,
      lastMessageAt: new Date("2026-05-18T11:56:00.000Z"),
      now: NOW,
    });
    expect(out).toContain("Last message: 4 minutes ago");
  });

  test("renders an em-dash when lastMessageAt is null", () => {
    const out = analyticsBucketScreen({
      window: "today",
      bucket: { received: 0, answered: 0, customers: 0 },
      lastMessageAt: null,
      now: NOW,
    });
    expect(out).toContain("Last message: —");
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
