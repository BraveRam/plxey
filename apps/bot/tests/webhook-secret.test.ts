import { describe, expect, test } from "bun:test";
import {
  verifyWebhookSecret,
  WEBHOOK_SECRET_HEADER,
} from "../src/lib/webhook-secret";

describe("verifyWebhookSecret", () => {
  test("returns true for an exact match", () => {
    expect(verifyWebhookSecret("abc123", "abc123")).toBe(true);
  });

  test("returns false when secrets differ", () => {
    expect(verifyWebhookSecret("abc123", "xyz789")).toBe(false);
  });

  test("returns false when actual is undefined", () => {
    expect(verifyWebhookSecret("abc123", undefined)).toBe(false);
  });

  test("returns false when actual is null", () => {
    expect(verifyWebhookSecret("abc123", null)).toBe(false);
  });

  test("returns false for empty string actual", () => {
    expect(verifyWebhookSecret("abc123", "")).toBe(false);
  });

  test("returns false when actual is a prefix of expected", () => {
    expect(verifyWebhookSecret("abc123", "abc")).toBe(false);
  });

  test("returns false when actual is longer than expected", () => {
    expect(verifyWebhookSecret("abc123", "abc1234")).toBe(false);
  });

  test("returns false when expected is empty (never trust an unset secret)", () => {
    expect(verifyWebhookSecret("", "anything")).toBe(false);
    expect(verifyWebhookSecret("", "")).toBe(false);
  });

  test("exports the canonical Telegram header name", () => {
    expect(WEBHOOK_SECRET_HEADER).toBe("X-Telegram-Bot-Api-Secret-Token");
  });
});
