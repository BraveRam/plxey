import { describe, expect, test } from "bun:test";
import { quotaErrorMessage } from "../src/api/quota-message";
import type { QuotaCheckResult } from "../src/lib/owners";

function quota(opts: Partial<QuotaCheckResult> = {}): QuotaCheckResult {
  return {
    ok: false,
    plan: "free",
    used: 1,
    limit: 1,
    ...opts,
  };
}

describe("quotaErrorMessage", () => {
  describe("kind=bot", () => {
    test("lapsed reason returns subscribe message", () => {
      const msg = quotaErrorMessage(quota({ reason: "lapsed" }), "bot");
      expect(msg).toBe("Subscribe to create a bot.");
    });

    test("banned reason returns subscribe message", () => {
      const msg = quotaErrorMessage(quota({ reason: "banned" }), "bot");
      expect(msg).toBe("Subscribe to create a bot.");
    });

    test("at_cap reason returns plan-aware blocked message", () => {
      const msg = quotaErrorMessage(
        quota({ reason: "at_cap", plan: "pro", limit: 3 }),
        "bot",
      );
      expect(msg).toBe(
        "Pro allows 3 bots. Delete an existing bot or upgrade to add another.",
      );
    });

    test("unknown reason returns subscribe message (safe default)", () => {
      const msg = quotaErrorMessage(quota({ reason: undefined }), "bot");
      expect(msg).toBe("Subscribe to create a bot.");
    });

    test("at_cap with null plan uses default label", () => {
      const msg = quotaErrorMessage(
        quota({ reason: "at_cap", plan: null, limit: 2 }),
        "bot",
      );
      expect(msg).toBe(
        "Your plan allows 2 bots. Delete an existing bot or upgrade to add another.",
      );
    });
  });

  describe("kind=doc", () => {
    test("lapsed reason returns subscribe message", () => {
      const msg = quotaErrorMessage(quota({ reason: "lapsed" }), "doc");
      expect(msg).toBe("Subscribe to upload documents.");
    });

    test("banned reason returns subscribe message", () => {
      const msg = quotaErrorMessage(quota({ reason: "banned" }), "doc");
      expect(msg).toBe("Subscribe to upload documents.");
    });

    test("at_cap reason returns plan-aware blocked message", () => {
      const msg = quotaErrorMessage(
        quota({ reason: "at_cap", plan: "pro", limit: 5 }),
        "doc",
      );
      expect(msg).toBe(
        "Your Pro only allows 5 docs per bot. Delete some or upgrade.",
      );
    });

    test("unknown reason returns subscribe message", () => {
      const msg = quotaErrorMessage(quota({ reason: undefined }), "doc");
      expect(msg).toBe("Subscribe to upload documents.");
    });
  });

  describe("kind=message", () => {
    test("returns generic quota message", () => {
      const msg = quotaErrorMessage(quota({ reason: "at_cap" }), "message");
      expect(msg).toBe("Quota reached. Try again later.");
    });
  });
});
