import { describe, expect, test } from "bun:test";
import {
  isOwnerBannedCached,
  markOwnerBanned,
  markOwnerUnbanned,
} from "../src/lib/banned";

// These tests share module-level state (the cache Set). Each test uses
// distinct ids to avoid order-dependence.

describe("banned-owners cache", () => {
  test("isOwnerBannedCached returns false for unseen owner", () => {
    expect(isOwnerBannedCached("never-seen-1001")).toBe(false);
  });

  test("markOwnerBanned puts the owner in the cache", () => {
    expect(isOwnerBannedCached("1002")).toBe(false);
    markOwnerBanned("1002");
    expect(isOwnerBannedCached("1002")).toBe(true);
  });

  test("markOwnerUnbanned removes the owner from the cache", () => {
    markOwnerBanned("1003");
    expect(isOwnerBannedCached("1003")).toBe(true);
    markOwnerUnbanned("1003");
    expect(isOwnerBannedCached("1003")).toBe(false);
  });

  test("markOwnerBanned is idempotent", () => {
    markOwnerBanned("1004");
    markOwnerBanned("1004");
    expect(isOwnerBannedCached("1004")).toBe(true);
    markOwnerUnbanned("1004");
    expect(isOwnerBannedCached("1004")).toBe(false);
  });

  test("markOwnerUnbanned on a never-banned owner is a no-op", () => {
    markOwnerUnbanned("1005-unknown");
    expect(isOwnerBannedCached("1005-unknown")).toBe(false);
  });

  test("isolates owners by id (no false positives)", () => {
    markOwnerBanned("1006");
    expect(isOwnerBannedCached("1006")).toBe(true);
    expect(isOwnerBannedCached("1006-different")).toBe(false);
    expect(isOwnerBannedCached("10060")).toBe(false);
    markOwnerUnbanned("1006");
  });
});
