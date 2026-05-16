import { describe, expect, test } from "bun:test";
import {
  canReadMessages,
  canReply,
  formatPermissions,
} from "../src/lib/business-rights";

describe("canReply", () => {
  test("returns true only when can_reply is explicitly true", () => {
    expect(canReply({ can_reply: true })).toBe(true);
    expect(canReply({ can_reply: false })).toBe(false);
    expect(canReply({})).toBe(false);
    expect(canReply(null)).toBe(false);
    expect(canReply(undefined)).toBe(false);
  });
});

describe("canReadMessages", () => {
  test("returns true only when can_read_messages is explicitly true", () => {
    expect(canReadMessages({ can_read_messages: true })).toBe(true);
    expect(canReadMessages({ can_read_messages: false })).toBe(false);
    expect(canReadMessages({})).toBe(false);
    expect(canReadMessages(null)).toBe(false);
  });
});

describe("formatPermissions", () => {
  test("shows the 'not connected' state when rights are absent", () => {
    const out = formatPermissions(null);
    expect(out).toContain("No business connection");
    expect(out).toContain("Telegram");
  });

  test("renders granted rights with ✅", () => {
    const out = formatPermissions({
      can_reply: true,
      can_read_messages: true,
    });
    expect(out).toContain("✅ Reply to messages");
    expect(out).toContain("✅ Read messages");
  });

  test("missing required rights show ⚠️ (not just ❌) to draw attention", () => {
    const out = formatPermissions({ can_reply: false });
    expect(out).toContain("⚠️ Reply to messages");
  });

  test("missing optional rights show ❌", () => {
    const out = formatPermissions({
      can_reply: true,
      can_delete_sent_messages: false,
    });
    expect(out).toContain("❌ Delete its own messages");
  });

  test("unknown fields don't break rendering (forward-compat)", () => {
    const out = formatPermissions({
      can_reply: true,
      can_send_random_stickers: true,
    } as unknown as Record<string, boolean>);
    expect(out).toContain("✅ Reply to messages");
    expect(typeof out).toBe("string");
  });
});
