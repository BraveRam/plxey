import { beforeEach, describe, expect, test } from "bun:test";
import {
  type CounterClient,
  counterKey,
  getDailyAiReplyCount,
  incrDailyAiReplyCount,
  utcDateKey,
} from "../src/lib/daily-ai-limit";

class FakeRedis implements CounterClient {
  store = new Map<string, number>();
  ttls = new Map<string, number>();

  async get(key: string): Promise<string | number | null> {
    return this.store.get(key) ?? null;
  }

  async incr(key: string): Promise<number> {
    const next = (this.store.get(key) ?? 0) + 1;
    this.store.set(key, next);
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (!this.store.has(key)) return 0;
    this.ttls.set(key, seconds);
    return 1;
  }
}

describe("utcDateKey", () => {
  test("formats UTC year+month+day", () => {
    const d = new Date("2026-05-18T12:34:56Z");
    expect(utcDateKey(d)).toBe("20260518");
  });

  test("uses UTC not local time at boundary", () => {
    // 23:30 UTC on 5-18 stays 5-18 even if local is +14
    const d = new Date(Date.UTC(2026, 4, 18, 23, 30, 0));
    expect(utcDateKey(d)).toBe("20260518");
  });

  test("zero-pads single-digit month and day", () => {
    const d = new Date(Date.UTC(2026, 0, 5));
    expect(utcDateKey(d)).toBe("20260105");
  });
});

describe("counterKey", () => {
  const now = new Date("2026-05-18T10:00:00Z");

  test("composes prefix:bot:user:date", () => {
    expect(counterKey("bot-uuid", "12345", now)).toBe(
      "airep:bot-uuid:12345:20260518",
    );
  });

  test("accepts numeric user id", () => {
    expect(counterKey("bot-uuid", 12345, now)).toBe(
      "airep:bot-uuid:12345:20260518",
    );
  });
});

describe("getDailyAiReplyCount", () => {
  let client: FakeRedis;
  const now = new Date("2026-05-18T10:00:00Z");

  beforeEach(() => {
    client = new FakeRedis();
  });

  test("returns 0 for unseen key", async () => {
    expect(await getDailyAiReplyCount("bot-a", "u1", client, now)).toBe(0);
  });

  test("returns the stored count", async () => {
    client.store.set(counterKey("bot-a", "u1", now), 7);
    expect(await getDailyAiReplyCount("bot-a", "u1", client, now)).toBe(7);
  });

  test("returns 0 if Redis returns a non-numeric string", async () => {
    client.store.set(counterKey("bot-a", "u1", now), "not-a-number" as never);
    expect(await getDailyAiReplyCount("bot-a", "u1", client, now)).toBe(0);
  });

  test("isolates count per bot", async () => {
    client.store.set(counterKey("bot-a", "u1", now), 5);
    expect(await getDailyAiReplyCount("bot-b", "u1", client, now)).toBe(0);
  });

  test("isolates count per user", async () => {
    client.store.set(counterKey("bot-a", "u1", now), 5);
    expect(await getDailyAiReplyCount("bot-a", "u2", client, now)).toBe(0);
  });

  test("isolates count per day", async () => {
    client.store.set(counterKey("bot-a", "u1", now), 5);
    const tomorrow = new Date("2026-05-19T10:00:00Z");
    expect(await getDailyAiReplyCount("bot-a", "u1", client, tomorrow)).toBe(0);
  });
});

describe("incrDailyAiReplyCount", () => {
  let client: FakeRedis;
  const now = new Date("2026-05-18T10:00:00Z");

  beforeEach(() => {
    client = new FakeRedis();
  });

  test("first call returns 1 and sets TTL", async () => {
    const n = await incrDailyAiReplyCount("bot-a", "u1", client, now);
    expect(n).toBe(1);
    expect(client.ttls.get(counterKey("bot-a", "u1", now))).toBe(90_000);
  });

  test("subsequent calls accumulate", async () => {
    await incrDailyAiReplyCount("bot-a", "u1", client, now);
    await incrDailyAiReplyCount("bot-a", "u1", client, now);
    const n = await incrDailyAiReplyCount("bot-a", "u1", client, now);
    expect(n).toBe(3);
  });

  test("each (bot,user,day) tuple is independent", async () => {
    await incrDailyAiReplyCount("bot-a", "u1", client, now);
    await incrDailyAiReplyCount("bot-a", "u1", client, now);
    await incrDailyAiReplyCount("bot-b", "u1", client, now);
    const a = await getDailyAiReplyCount("bot-a", "u1", client, now);
    const b = await getDailyAiReplyCount("bot-b", "u1", client, now);
    expect(a).toBe(2);
    expect(b).toBe(1);
  });
});
