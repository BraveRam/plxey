import { describe, expect, test } from "bun:test";
import { _testing } from "../src/lib/analytics-stats";
import type { BotStats } from "../src/lib/analytics-stats";

const { cacheKey, toCache, fromCache, CACHE_TTL_SECONDS } = _testing;

const sampleStats: BotStats = {
  today: { received: 5, answered: 4, customers: 2 },
  last7d: { received: 33, answered: 28, customers: 7 },
  last30d: { received: 120, answered: 99, customers: 19 },
  lastMessageAt: new Date("2026-05-18T10:00:00.000Z"),
};

describe("analytics-stats cache helpers", () => {
  test("cacheKey is per-bot and stable", () => {
    expect(cacheKey("bot-uuid-1")).toBe("stats:bot:bot-uuid-1");
    expect(cacheKey("bot-uuid-2")).toBe("stats:bot:bot-uuid-2");
  });

  test("TTL is 60s — owner can re-tap inside the window", () => {
    expect(CACHE_TTL_SECONDS).toBe(60);
  });

  test("toCache → fromCache round-trips, lastMessageAt becomes a Date", () => {
    const wire = toCache(sampleStats);
    expect(wire.lastMessageAt).toBe("2026-05-18T10:00:00.000Z");
    const back = fromCache(wire);
    expect(back).not.toBeNull();
    expect(back?.lastMessageAt).toBeInstanceOf(Date);
    expect(back?.lastMessageAt?.toISOString()).toBe(
      "2026-05-18T10:00:00.000Z",
    );
    expect(back?.today).toEqual(sampleStats.today);
    expect(back?.last7d).toEqual(sampleStats.last7d);
    expect(back?.last30d).toEqual(sampleStats.last30d);
  });

  test("toCache preserves null lastMessageAt", () => {
    const wire = toCache({
      ...sampleStats,
      lastMessageAt: null,
    });
    expect(wire.lastMessageAt).toBeNull();
    const back = fromCache(wire);
    expect(back?.lastMessageAt).toBeNull();
  });

  test("fromCache rejects garbage", () => {
    expect(fromCache(null)).toBeNull();
    expect(fromCache(undefined)).toBeNull();
    expect(fromCache("string")).toBeNull();
    expect(fromCache({})).toBeNull();
    expect(fromCache({ today: { received: 1, answered: 1, customers: 1 } })).toBeNull();
  });

  test("fromCache reads stringified-and-parsed JSON shape from Upstash", () => {
    // Upstash returns objects directly for JSON values; this guards
    // against future driver shape changes.
    const wire = JSON.parse(JSON.stringify(toCache(sampleStats)));
    const back = fromCache(wire);
    expect(back?.today).toEqual(sampleStats.today);
  });
});
