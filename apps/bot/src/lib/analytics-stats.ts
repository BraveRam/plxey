import { sql } from "drizzle-orm";
import { db } from "@tg-business/db";
import { logger } from "./logger";
import { redis } from "./redis";

/**
 * Per-bot activity stats surfaced on the owner-facing 📊 Analytics
 * screen. Three rolling windows (today / 7d / 30d) plus the
 * "last customer message" timestamp.
 *
 * Computed in a single SQL round-trip via FILTER aggregates over a
 * messages → conversations join, scoped to `business_connections`
 * for the given bot. Cached in Upstash for 60s per bot — the screen
 * is owner-facing and doesn't need minute-fresh data, while a busy
 * owner re-tapping the button shouldn't re-hammer the DB.
 *
 * `received` counts `role = 'user'` rows (customer messages that
 * survived the over-quota check — see registry.ts). `answered`
 * counts `role = 'assistant'` rows (AI replies). The difference =
 * customer messages that hit busy-reply / rate-limit / missing
 * permission / quota wall.
 */

export interface BotStatsBucket {
  received: number;
  answered: number;
  customers: number;
}

export interface BotStats {
  today: BotStatsBucket;
  last7d: BotStatsBucket;
  last30d: BotStatsBucket;
  lastMessageAt: Date | null;
}

const EMPTY_STATS: BotStats = {
  today: { received: 0, answered: 0, customers: 0 },
  last7d: { received: 0, answered: 0, customers: 0 },
  last30d: { received: 0, answered: 0, customers: 0 },
  lastMessageAt: null,
};

const CACHE_TTL_SECONDS = 60;

function cacheKey(botId: string): string {
  return `stats:bot:${botId}`;
}

// Serialized cache shape: lastMessageAt is an ISO string (or null).
interface CachedShape {
  today: BotStatsBucket;
  last7d: BotStatsBucket;
  last30d: BotStatsBucket;
  lastMessageAt: string | null;
}

function toCache(stats: BotStats): CachedShape {
  return {
    today: stats.today,
    last7d: stats.last7d,
    last30d: stats.last30d,
    lastMessageAt: stats.lastMessageAt
      ? stats.lastMessageAt.toISOString()
      : null,
  };
}

function fromCache(raw: unknown): BotStats | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<CachedShape>;
  if (!r.today || !r.last7d || !r.last30d) return null;
  return {
    today: r.today,
    last7d: r.last7d,
    last30d: r.last30d,
    lastMessageAt:
      typeof r.lastMessageAt === "string" ? new Date(r.lastMessageAt) : null,
  };
}

function numFromRow(row: Record<string, unknown>, key: string): number {
  const v = row[key];
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Run the aggregate SQL. Exposed for testing — production callers
 * should use `getBotStats` which adds the cache layer.
 */
export async function fetchBotStatsFromDb(botId: string): Promise<BotStats> {
  const res = await db.execute(sql`
    with bot_conns as (
      select business_connection_id
      from business_connections
      where tenant_bot_id = ${botId} and is_enabled = true
    )
    select
      count(*) filter (where m.role = 'user'      and m.created_at >= now() - interval '1 day')   as recv_1d,
      count(*) filter (where m.role = 'assistant' and m.created_at >= now() - interval '1 day')   as ans_1d,
      count(distinct c.telegram_chat_id) filter (where m.created_at >= now() - interval '1 day')  as cust_1d,

      count(*) filter (where m.role = 'user'      and m.created_at >= now() - interval '7 days')  as recv_7d,
      count(*) filter (where m.role = 'assistant' and m.created_at >= now() - interval '7 days')  as ans_7d,
      count(distinct c.telegram_chat_id) filter (where m.created_at >= now() - interval '7 days') as cust_7d,

      count(*) filter (where m.role = 'user'      and m.created_at >= now() - interval '30 days') as recv_30d,
      count(*) filter (where m.role = 'assistant' and m.created_at >= now() - interval '30 days') as ans_30d,
      count(distinct c.telegram_chat_id) filter (where m.created_at >= now() - interval '30 days') as cust_30d,

      max(m.created_at) as last_at
    from messages m
    join conversations c on c.id = m.conversation_id
    where c.business_connection_id in (select business_connection_id from bot_conns)
  `);

  // Neon HTTP driver returns rows on `.rows` for SELECT. Tolerate the
  // alternate shape (some Drizzle versions / drivers return the array
  // directly) so this stays portable.
  const rows = (res as unknown as { rows?: Record<string, unknown>[] })
    .rows ?? (res as unknown as Record<string, unknown>[]);
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row) return EMPTY_STATS;

  const lastAtRaw = row["last_at"];
  const lastMessageAt =
    typeof lastAtRaw === "string"
      ? new Date(lastAtRaw)
      : lastAtRaw instanceof Date
        ? lastAtRaw
        : null;

  return {
    today: {
      received: numFromRow(row, "recv_1d"),
      answered: numFromRow(row, "ans_1d"),
      customers: numFromRow(row, "cust_1d"),
    },
    last7d: {
      received: numFromRow(row, "recv_7d"),
      answered: numFromRow(row, "ans_7d"),
      customers: numFromRow(row, "cust_7d"),
    },
    last30d: {
      received: numFromRow(row, "recv_30d"),
      answered: numFromRow(row, "ans_30d"),
      customers: numFromRow(row, "cust_30d"),
    },
    lastMessageAt,
  };
}

/**
 * Get per-bot stats with a 60s Upstash cache. Cache failures (Redis
 * down) fall through to the DB transparently — analytics is not a
 * critical path.
 */
export async function getBotStats(botId: string): Promise<BotStats> {
  const key = cacheKey(botId);

  try {
    const cached = await redis().get(key);
    if (cached) {
      const parsed = fromCache(cached);
      if (parsed) return parsed;
    }
  } catch (err) {
    logger.warn({ err, botId }, "stats cache read failed");
  }

  const fresh = await fetchBotStatsFromDb(botId).catch((err) => {
    logger.warn({ err, botId }, "stats DB query failed");
    return EMPTY_STATS;
  });

  // Best-effort cache write. Use SET … EX so a single round-trip
  // covers the value + TTL.
  try {
    await redis().set(key, toCache(fresh), { ex: CACHE_TTL_SECONDS });
  } catch (err) {
    logger.warn({ err, botId }, "stats cache write failed");
  }

  return fresh;
}

/** Test helper — expose the cache key shape for assertions. */
export const _testing = {
  cacheKey,
  toCache,
  fromCache,
  CACHE_TTL_SECONDS,
};
