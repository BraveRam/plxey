/**
 * Cross-tenant admin analytics, sourced entirely from Neon. Powers the
 * admin dashboard Mini App. All numbers are exact (Postgres aggregation),
 * unlike PostHog. Mirrors the `analytics-stats.ts` patterns: `db.execute`
 * raw SQL, tolerant `.rows` extraction, and a short Redis cache so a busy
 * operator re-loading the dashboard doesn't re-hammer the DB.
 *
 * Metrics NOT available from Neon (out of scope here): per-user daily AI
 * counts (Redis), latency / token cost / webhook health (logs/PostHog).
 */

import { sql, eq, or, ilike } from "drizzle-orm";
import { db, owners, subscriptions, tenantBots, tenants } from "@tg-business/db";
import { logger } from "./logger";
import { redis } from "./redis";

const DAY_MS = 24 * 60 * 60 * 1000;
const METRICS_CACHE_TTL_SECONDS = 60;

export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * Resolve the dashboard's date window. Both bounds optional: missing `to`
 * → now; missing `from` → 30 days before `to`. Inverted bounds are swapped;
 * unparseable input falls back to the default. `now` is injectable for tests.
 */
export function parseDateRange(
  fromRaw?: string,
  toRaw?: string,
  now: Date = new Date(),
): DateRange {
  const parse = (s?: string): Date | null => {
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  let to = parse(toRaw) ?? now;
  let from = parse(fromRaw) ?? new Date(to.getTime() - 30 * DAY_MS);
  if (from.getTime() > to.getTime()) {
    [from, to] = [to, from];
  }
  return { from, to };
}

// ---------------------------------------------------------------------------
// Row helpers (Neon HTTP returns rows on `.rows`; tolerate the array shape).
// ---------------------------------------------------------------------------

function rowsOf(res: unknown): Record<string, unknown>[] {
  const r = (res as { rows?: Record<string, unknown>[] }).rows;
  if (Array.isArray(r)) return r;
  return Array.isArray(res) ? (res as Record<string, unknown>[]) : [];
}

function num(row: Record<string, unknown> | undefined, key: string): number {
  if (!row) return 0;
  const v = row[key];
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export interface AdminKpis {
  totalOwners: number;
  bannedOwners: number;
  activeBots: number;
  totalDocs: number;
  readyDocs: number;
  activePro: number;
  activeBusiness: number;
  mrrStars: number;
  compSubs: number;
}

export interface AdminTotals {
  revenueStars: number;
  refundStars: number;
  newOwners: number;
  newSubs: number;
  cancellations: number;
  customerMessages: number;
  aiMessages: number;
  uniqueCustomers: number;
}

export interface AdminSeries {
  revenue: Array<{ date: string; stars: number }>;
  signups: Array<{ date: string; count: number }>;
  newSubs: Array<{ date: string; count: number }>;
  cancellations: Array<{ date: string; count: number }>;
  messages: Array<{ date: string; received: number; answered: number }>;
}

export interface AdminBreakdowns {
  subsByStatus: Record<string, number>;
  subsByPlanActive: Record<string, number>;
  botsByStatus: Record<string, number>;
  docsByStatus: Record<string, number>;
}

export interface AdminMetrics {
  range: { from: string; to: string };
  kpis: AdminKpis;
  totals: AdminTotals;
  series: AdminSeries;
  breakdowns: AdminBreakdowns;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function fetchKpis(): Promise<AdminKpis> {
  const res = await db.execute(sql`
    select
      (select count(*) from owners)::int                                                            as total_owners,
      (select count(*) from owners where is_banned)::int                                            as banned_owners,
      (select count(*) from tenant_bots where status = 'active')::int                               as active_bots,
      (select count(*) from documents)::int                                                         as total_docs,
      (select count(*) from documents where status = 'ready')::int                                  as ready_docs,
      (select count(*) from subscriptions
         where status='active' and current_period_end > now() and not is_complimentary and plan='pro')::int      as active_pro,
      (select count(*) from subscriptions
         where status='active' and current_period_end > now() and not is_complimentary and plan='business')::int as active_business,
      (select coalesce(sum(stars_per_period),0) from subscriptions
         where status='active' and current_period_end > now() and not is_complimentary)::int        as mrr_stars,
      (select count(*) from subscriptions where is_complimentary)::int                              as comp_subs
  `);
  const row = rowsOf(res)[0];
  return {
    totalOwners: num(row, "total_owners"),
    bannedOwners: num(row, "banned_owners"),
    activeBots: num(row, "active_bots"),
    totalDocs: num(row, "total_docs"),
    readyDocs: num(row, "ready_docs"),
    activePro: num(row, "active_pro"),
    activeBusiness: num(row, "active_business"),
    mrrStars: num(row, "mrr_stars"),
    compSubs: num(row, "comp_subs"),
  };
}

async function fetchTotals(from: string, to: string): Promise<AdminTotals> {
  const res = await db.execute(sql`
    select
      (select coalesce(sum(stars_amount),0) from star_payments
         where stars_amount > 0 and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz)::int as revenue_stars,
      (select coalesce(sum(abs(stars_amount)),0) from star_payments
         where stars_amount < 0 and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz)::int as refund_stars,
      (select count(*) from owners
         where first_seen_at >= ${from}::timestamptz and first_seen_at < ${to}::timestamptz)::int as new_owners,
      (select count(*) from subscriptions
         where not is_complimentary and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz)::int as new_subs,
      (select count(*) from subscriptions
         where status='canceled' and canceled_at >= ${from}::timestamptz and canceled_at < ${to}::timestamptz)::int as cancellations,
      (select count(*) from messages
         where role='user' and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz)::int as customer_messages,
      (select count(*) from messages
         where role='assistant' and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz)::int as ai_messages,
      (select count(distinct c.telegram_chat_id) from messages m
         join conversations c on c.id = m.conversation_id
         where m.created_at >= ${from}::timestamptz and m.created_at < ${to}::timestamptz)::int as unique_customers
  `);
  const row = rowsOf(res)[0];
  return {
    revenueStars: num(row, "revenue_stars"),
    refundStars: num(row, "refund_stars"),
    newOwners: num(row, "new_owners"),
    newSubs: num(row, "new_subs"),
    cancellations: num(row, "cancellations"),
    customerMessages: num(row, "customer_messages"),
    aiMessages: num(row, "ai_messages"),
    uniqueCustomers: num(row, "unique_customers"),
  };
}

async function fetchBreakdowns(): Promise<AdminBreakdowns> {
  const toMap = (res: unknown, key: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const r of rowsOf(res)) {
      const k = r[key];
      if (typeof k === "string") out[k] = num(r, "n");
    }
    return out;
  };
  const [subsStatus, subsPlan, botsStatus, docsStatus] = await Promise.all([
    db.execute(sql`select status, count(*)::int as n from subscriptions group by status`),
    db.execute(sql`select plan, count(*)::int as n from subscriptions
      where status='active' and current_period_end > now() and not is_complimentary group by plan`),
    db.execute(sql`select status, count(*)::int as n from tenant_bots group by status`),
    db.execute(sql`select status, count(*)::int as n from documents group by status`),
  ]);
  return {
    subsByStatus: toMap(subsStatus, "status"),
    subsByPlanActive: toMap(subsPlan, "plan"),
    botsByStatus: toMap(botsStatus, "status"),
    docsByStatus: toMap(docsStatus, "status"),
  };
}

/** Zero-filled daily series. `valueExpr` aggregates one source table by day. */
function dayRows(res: unknown): Array<{ date: string; a: number; b: number }> {
  return rowsOf(res).map((r) => ({
    date: typeof r["date"] === "string" ? (r["date"] as string) : "",
    a: num(r, "a"),
    b: num(r, "b"),
  }));
}

async function fetchSeries(from: string, to: string): Promise<AdminSeries> {
  // Each series left-joins a per-day aggregate onto a generate_series day
  // axis so there are no gaps. `a`/`b` are the (up to two) metrics per day.
  const [rev, signups, newSubs, cancels, msgs] = await Promise.all([
    db.execute(sql`
      select to_char(d, 'YYYY-MM-DD') as date, coalesce(x.a,0)::int as a, 0::int as b
      from generate_series(${from}::date, ${to}::date, interval '1 day') d
      left join (select date_trunc('day', created_at)::date as day, sum(stars_amount) as a
                 from star_payments where stars_amount > 0
                   and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz
                 group by 1) x on x.day = d::date
      order by d`),
    db.execute(sql`
      select to_char(d, 'YYYY-MM-DD') as date, coalesce(x.a,0)::int as a, 0::int as b
      from generate_series(${from}::date, ${to}::date, interval '1 day') d
      left join (select date_trunc('day', first_seen_at)::date as day, count(*) as a
                 from owners where first_seen_at >= ${from}::timestamptz and first_seen_at < ${to}::timestamptz
                 group by 1) x on x.day = d::date
      order by d`),
    db.execute(sql`
      select to_char(d, 'YYYY-MM-DD') as date, coalesce(x.a,0)::int as a, 0::int as b
      from generate_series(${from}::date, ${to}::date, interval '1 day') d
      left join (select date_trunc('day', created_at)::date as day, count(*) as a
                 from subscriptions where not is_complimentary
                   and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz
                 group by 1) x on x.day = d::date
      order by d`),
    db.execute(sql`
      select to_char(d, 'YYYY-MM-DD') as date, coalesce(x.a,0)::int as a, 0::int as b
      from generate_series(${from}::date, ${to}::date, interval '1 day') d
      left join (select date_trunc('day', canceled_at)::date as day, count(*) as a
                 from subscriptions where status='canceled' and canceled_at is not null
                   and canceled_at >= ${from}::timestamptz and canceled_at < ${to}::timestamptz
                 group by 1) x on x.day = d::date
      order by d`),
    db.execute(sql`
      select to_char(d, 'YYYY-MM-DD') as date,
             coalesce(x.recv,0)::int as a, coalesce(x.ans,0)::int as b
      from generate_series(${from}::date, ${to}::date, interval '1 day') d
      left join (select date_trunc('day', created_at)::date as day,
                        count(*) filter (where role='user') as recv,
                        count(*) filter (where role='assistant') as ans
                 from messages where created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz
                 group by 1) x on x.day = d::date
      order by d`),
  ]);
  return {
    revenue: dayRows(rev).map((r) => ({ date: r.date, stars: r.a })),
    signups: dayRows(signups).map((r) => ({ date: r.date, count: r.a })),
    newSubs: dayRows(newSubs).map((r) => ({ date: r.date, count: r.a })),
    cancellations: dayRows(cancels).map((r) => ({ date: r.date, count: r.a })),
    messages: dayRows(msgs).map((r) => ({ date: r.date, received: r.a, answered: r.b })),
  };
}

/**
 * Full dashboard payload for a date range, cached ~60s per range. Cache
 * failures fall through to the DB.
 */
export async function getAdminMetrics(range: DateRange): Promise<AdminMetrics> {
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();
  const key = `admin:metrics:${fromIso}:${toIso}`;

  try {
    const cached = await redis().get<AdminMetrics>(key);
    if (cached) return cached;
  } catch (err) {
    logger.warn({ err }, "admin metrics cache read failed");
  }

  const [kpis, totals, breakdowns, series] = await Promise.all([
    fetchKpis(),
    fetchTotals(fromIso, toIso),
    fetchBreakdowns(),
    fetchSeries(fromIso, toIso),
  ]);
  const metrics: AdminMetrics = {
    range: { from: fromIso, to: toIso },
    kpis,
    totals,
    breakdowns,
    series,
  };

  try {
    await redis().set(key, metrics, { ex: METRICS_CACHE_TTL_SECONDS });
  } catch (err) {
    logger.warn({ err }, "admin metrics cache write failed");
  }
  return metrics;
}

// ---------------------------------------------------------------------------
// Owner drill-down
// ---------------------------------------------------------------------------

export interface AdminOwnerRow {
  telegramUserId: string;
  username: string | null;
  firstName: string | null;
  currentPlan: string | null;
  subscriptionStatus: string;
  botCount: number;
  docCount: number;
  messagesThisPeriod: number;
  lifetimeStarsSpent: number;
  isBanned: boolean;
  firstSeenAt: string;
}

const OWNERS_PAGE_SIZE = 25;

/**
 * Paginated owner list for the drill-down table. `search` matches a numeric
 * id exactly or a username (with/without `@`) case-insensitively.
 */
export async function listAdminOwners(args: {
  search?: string;
  page?: number;
}): Promise<{
  rows: AdminOwnerRow[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  total: number;
}> {
  const page = Math.max(1, Math.floor(args.page ?? 1));
  const search = (args.search ?? "").trim();

  const where = search
    ? /^\d+$/.test(search)
      ? eq(owners.telegramUserId, search)
      : or(
          ilike(owners.username, search.startsWith("@") ? search.slice(1) : search),
          eq(owners.telegramUserId, search),
        )
    : undefined;

  // Page rows (fetch +1 to derive hasMore) and the matching total run in
  // parallel — the total drives the "Page X of Y" / "N owners" UI.
  const [found, total] = await Promise.all([
    db.query.owners.findMany({
      where,
      orderBy: (o, { desc: d }) => [d(o.firstSeenAt)],
      limit: OWNERS_PAGE_SIZE + 1,
      offset: (page - 1) * OWNERS_PAGE_SIZE,
    }),
    db.$count(owners, where),
  ]);
  const hasMore = found.length > OWNERS_PAGE_SIZE;
  const rows = found.slice(0, OWNERS_PAGE_SIZE).map(
    (o): AdminOwnerRow => ({
      telegramUserId: o.telegramUserId,
      username: o.username,
      firstName: o.firstName,
      currentPlan: o.currentPlan,
      subscriptionStatus: o.subscriptionStatus,
      botCount: o.botCount,
      docCount: o.docCount,
      messagesThisPeriod: o.messagesThisPeriod,
      lifetimeStarsSpent: o.lifetimeStarsSpent,
      isBanned: o.isBanned,
      firstSeenAt: o.firstSeenAt.toISOString(),
    }),
  );
  return { rows, page, pageSize: OWNERS_PAGE_SIZE, hasMore, total };
}

export interface AdminOwnerDetail extends AdminOwnerRow {
  subscriptions: Array<{
    plan: string;
    status: string;
    isComplimentary: boolean;
    starsPerPeriod: number;
    currentPeriodEnd: string;
    canceledAt: string | null;
  }>;
  bots: Array<{
    botUsername: string | null;
    status: string;
    overQuotaAt: string | null;
  }>;
}

/** One owner's full detail (subscriptions + bots) for the drill-down view. */
export async function getAdminOwnerDetail(
  ownerId: string,
): Promise<AdminOwnerDetail | null> {
  const owner = await db.query.owners.findFirst({
    where: eq(owners.telegramUserId, ownerId),
  });
  if (!owner) return null;

  const [subs, botRes] = await Promise.all([
    db.query.subscriptions.findMany({
      where: eq(subscriptions.ownerTelegramUserId, ownerId),
      orderBy: (s, { desc: d }) => [d(s.createdAt)],
    }),
    db.execute(sql`
      select tb.bot_username, tb.status, tb.over_quota_at
      from ${tenantBots} tb join ${tenants} t on t.id = tb.tenant_id
      where t.telegram_owner_id = ${ownerId}
    `),
  ]);

  return {
    telegramUserId: owner.telegramUserId,
    username: owner.username,
    firstName: owner.firstName,
    currentPlan: owner.currentPlan,
    subscriptionStatus: owner.subscriptionStatus,
    botCount: owner.botCount,
    docCount: owner.docCount,
    messagesThisPeriod: owner.messagesThisPeriod,
    lifetimeStarsSpent: owner.lifetimeStarsSpent,
    isBanned: owner.isBanned,
    firstSeenAt: owner.firstSeenAt.toISOString(),
    subscriptions: subs.map((s) => ({
      plan: s.plan,
      status: s.status,
      isComplimentary: s.isComplimentary,
      starsPerPeriod: s.starsPerPeriod,
      currentPeriodEnd: s.currentPeriodEnd.toISOString(),
      canceledAt: s.canceledAt ? s.canceledAt.toISOString() : null,
    })),
    bots: rowsOf(botRes).map((r) => ({
      botUsername: typeof r["bot_username"] === "string" ? (r["bot_username"] as string) : null,
      status: typeof r["status"] === "string" ? (r["status"] as string) : "unknown",
      overQuotaAt:
        r["over_quota_at"] instanceof Date
          ? (r["over_quota_at"] as Date).toISOString()
          : typeof r["over_quota_at"] === "string"
            ? (r["over_quota_at"] as string)
            : null,
    })),
  };
}
