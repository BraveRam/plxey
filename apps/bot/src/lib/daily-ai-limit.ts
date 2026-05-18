import { redis } from "./redis";

/**
 * Per-end-user daily AI-reply counter.
 *
 * Each tenant bot can configure a cap on how many AI-generated replies a
 * single end user can receive in a calendar-day UTC window. When the cap
 * is hit, the bot sends a canned "we're busy, will get back to you" reply
 * instead of invoking the AI tool — protecting the owner's monthly
 * `messages_this_period` budget from being burned by one heavy user.
 *
 * Counter key: `airep:{botId}:{userId}:{utcDate-YYYYMMDD}`.
 *
 * Increment only happens after a successful AI generation, so transient
 * Gateway errors don't burn the end-user's quota.
 */

const PREFIX = "airep";

/** YYYYMMDD in UTC — matches the calendar-day reset semantics. */
export function utcDateKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function counterKey(
  botId: string,
  userId: string | number,
  now: Date = new Date(),
): string {
  return `${PREFIX}:${botId}:${userId}:${utcDateKey(now)}`;
}

// Minimal Redis surface we need — lets tests inject an in-memory stub.
export interface CounterClient {
  get(key: string): Promise<string | number | null>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

/** Reads current count for the given (bot, user, today). 0 if absent. */
export async function getDailyAiReplyCount(
  botId: string,
  userId: string | number,
  client: CounterClient = redis() as unknown as CounterClient,
  now: Date = new Date(),
): Promise<number> {
  const raw = await client.get(counterKey(botId, userId, now));
  if (raw === null || raw === undefined) return 0;
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * INCR + set TTL on first hit. Returns new count.
 *
 * EXPIRE is called every call (cheap on Upstash REST, idempotent). 86400s
 * + a small buffer so a counter created near midnight UTC survives the
 * boundary check it was meant to cover.
 */
export async function incrDailyAiReplyCount(
  botId: string,
  userId: string | number,
  client: CounterClient = redis() as unknown as CounterClient,
  now: Date = new Date(),
): Promise<number> {
  const key = counterKey(botId, userId, now);
  const n = await client.incr(key);
  await client.expire(key, 90_000);
  return n;
}
