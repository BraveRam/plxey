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

/**
 * Per-IP rate limit for the public /api/* surface.
 *
 * Sliding window: 120 requests / 60 seconds. The mini-app and any future
 * external integrations all share this budget per source IP. Generous
 * enough not to block a real owner clicking around their dashboard, tight
 * enough to catch scripted abuse.
 *
 * Key: `rl:api:{ip}`.
 */
let cachedApiLimit: Ratelimit | null = null;

export function apiLimiter(): Ratelimit {
  if (cachedApiLimit) return cachedApiLimit;
  cachedApiLimit = new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.slidingWindow(120, "60 s"),
    prefix: "rl:api",
    analytics: false,
  });
  return cachedApiLimit;
}

/**
 * Per-bot rate limit on the "🔄 Refresh" button in the permissions panel.
 *
 * Fixed window: 1 call / 3 seconds. Stops accidental double-taps from
 * firing two getBusinessConnection requests against Telegram in
 * succession. We use rate-limiting here instead of caching the response
 * because Refresh is meant to mean "give me a fresh value" — caching
 * would silently serve stale data; rate-limiting just lengthens the
 * window between fresh fetches.
 *
 * Key: `rl:perm-refresh:{botId}`.
 */
let cachedRefreshLimit: Ratelimit | null = null;

export function permissionRefreshLimiter(): Ratelimit {
  if (cachedRefreshLimit) return cachedRefreshLimit;
  cachedRefreshLimit = new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.fixedWindow(1, "3 s"),
    prefix: "rl:perm-refresh",
    analytics: false,
  });
  return cachedRefreshLimit;
}

/**
 * Per-bot limiter for the Restart action (onboarding bot button + Mini App
 * `POST /bots/:id/restart`). `setWebhook` is hard rate-limited by Telegram
 * (~1 call/sec/bot); restarting is a deliberate recovery action, so cap it
 * at one per window to stop button-mashing from triggering a 429 storm.
 *
 * Key: `rl:bot-restart:{botId}`.
 */
let cachedRestartLimit: Ratelimit | null = null;

export function restartLimiter(): Ratelimit {
  if (cachedRestartLimit) return cachedRestartLimit;
  cachedRestartLimit = new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.fixedWindow(1, "5 s"),
    prefix: "rl:bot-restart",
    analytics: false,
  });
  return cachedRestartLimit;
}
