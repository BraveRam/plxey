import { describe, expect, test } from "bun:test";
import { cbd, CALLBACK_DATA_MAX_BYTES } from "../src/lib/callback-data";

describe("cbd (callback_data guard)", () => {
  test("passes strings within the 64-byte cap unchanged", () => {
    expect(cbd("billing_menu")).toBe("billing_menu");
    expect(cbd("a".repeat(CALLBACK_DATA_MAX_BYTES))).toHaveLength(
      CALLBACK_DATA_MAX_BYTES,
    );
  });

  test("throws when a string exceeds the cap", () => {
    expect(() => cbd("a".repeat(CALLBACK_DATA_MAX_BYTES + 1))).toThrow(
      /exceeds Telegram's 64-byte cap/,
    );
  });

  test("counts BYTES, not characters (multi-byte UTF-8 counts more)", () => {
    // 🚀 is 4 UTF-8 bytes — 16 of them sit right at the cap. Should pass.
    expect(() => cbd("🚀".repeat(16))).not.toThrow();
    // 17 emojis = 68 bytes — should throw.
    expect(() => cbd("🚀".repeat(17))).toThrow();
  });

  test("error message truncates a long offender for the log", () => {
    try {
      cbd("a".repeat(200));
      throw new Error("expected throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain("200 bytes");
      expect(message).toContain("…");
    }
  });
});

// ---------------------------------------------------------------------------
// Realistic billing callback shapes — every dynamic-data pattern in billing.ts
// must fit at its maximum input size. Adding a test here is cheap and
// prevents the bug we hit twice already.
// ---------------------------------------------------------------------------

describe("realistic callback shapes fit within 64 bytes", () => {
  // Telegram payment charge ids run up to about 140 chars — far over the
  // limit on their own. We use the subscription row's UUID (36 chars)
  // instead. The test asserts the UUID-based shape fits.
  const fullUuid = "12345678-1234-1234-1234-123456789012"; // 36 bytes

  test("cancel-confirm: billing_cancel_confirm_{uuid}", () => {
    const data = `billing_cancel_confirm_${fullUuid}`;
    expect(() => cbd(data)).not.toThrow();
  });

  test("cancel-reason: bcr_{key}_{uuid} for the longest reason key", () => {
    // Longest CANCEL_REASONS key is `switching_tools` (15 chars).
    const longest = "switching_tools";
    const data = `bcr_${longest}_${fullUuid}`;
    expect(() => cbd(data)).not.toThrow();
  });
});
