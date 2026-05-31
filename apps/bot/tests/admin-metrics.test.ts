import { describe, expect, test } from "bun:test";
import { parseDateRange } from "../src/lib/admin-metrics";
import { __test } from "../src/bots/admin-commands";

const { isAdminOwnerId } = __test;

describe("isAdminOwnerId", () => {
  test("true only when the id matches the configured admin id", () => {
    expect(isAdminOwnerId("123", "123")).toBe(true);
  });
  test("false on mismatch", () => {
    expect(isAdminOwnerId("456", "123")).toBe(false);
  });
  test("false when admin id is unset (fail-closed)", () => {
    expect(isAdminOwnerId("123", undefined)).toBe(false);
    expect(isAdminOwnerId("123", "")).toBe(false);
  });
  test("false when owner id is missing", () => {
    expect(isAdminOwnerId(undefined, "123")).toBe(false);
  });
});

describe("parseDateRange", () => {
  const NOW = new Date("2026-05-30T12:00:00.000Z");
  const DAY = 24 * 60 * 60 * 1000;

  test("defaults to the last 30 days when both bounds are missing", () => {
    const { from, to } = parseDateRange(undefined, undefined, NOW);
    expect(to.getTime()).toBe(NOW.getTime());
    expect(to.getTime() - from.getTime()).toBe(30 * DAY);
  });

  test("uses explicit from + to when valid", () => {
    const { from, to } = parseDateRange("2026-05-01", "2026-05-15", NOW);
    expect(from.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(to.toISOString().slice(0, 10)).toBe("2026-05-15");
  });

  test("missing 'to' defaults to now; missing 'from' defaults to to-30d", () => {
    const onlyFrom = parseDateRange("2026-05-20", undefined, NOW);
    expect(onlyFrom.to.getTime()).toBe(NOW.getTime());
    expect(onlyFrom.from.toISOString().slice(0, 10)).toBe("2026-05-20");

    const onlyTo = parseDateRange(undefined, "2026-05-20", NOW);
    expect(onlyTo.to.toISOString().slice(0, 10)).toBe("2026-05-20");
    expect(onlyTo.to.getTime() - onlyTo.from.getTime()).toBe(30 * DAY);
  });

  test("swaps inverted bounds so from <= to", () => {
    const { from, to } = parseDateRange("2026-05-15", "2026-05-01", NOW);
    expect(from.getTime()).toBeLessThanOrEqual(to.getTime());
    expect(from.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(to.toISOString().slice(0, 10)).toBe("2026-05-15");
  });

  test("falls back to defaults on unparseable input", () => {
    const { from, to } = parseDateRange("not-a-date", "also-bad", NOW);
    expect(to.getTime()).toBe(NOW.getTime());
    expect(to.getTime() - from.getTime()).toBe(30 * DAY);
  });
});
