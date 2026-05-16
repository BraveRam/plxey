import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

// Single shared Redis client. Reads env at first access so we fail fast at
// startup if it's misconfigured.
let cached: Redis | null = null;

export function redis(): Redis {
  if (cached) return cached;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set",
    );
  }
  cached = new Redis({ url, token });
  return cached;
}

/**
 * Per-customer-per-bot rate limit for incoming business messages.
 *
 * Sliding window: 10 messages / 60 seconds. Burst-friendly enough for real
 * conversations, tight enough that a spammer hammering an AI-backed bot
 * gets capped before they can run up the owner's Gateway bill.
 *
 * Key: `rl:msg:{botId}:{customerTelegramUserId}`.
 */
let cachedMsgLimit: Ratelimit | null = null;

export function customerMessageLimiter(): Ratelimit {
  if (cachedMsgLimit) return cachedMsgLimit;
  cachedMsgLimit = new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.slidingWindow(10, "60 s"),
    prefix: "rl:msg",
    analytics: false,
  });
  return cachedMsgLimit;
}
