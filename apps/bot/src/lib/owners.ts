/**
 * Owner-side billing helpers — profile capture, atomic counter updates,
 * quota gating, plan reconciliation, and over-quota enforcement.
 *
 * Implements the "Owner Profile", "Plan-Cap Enforcement" and "Over-Quota
 * Reconciliation" sections of SUBSCRIPTION.md.
 *
 * All async functions in this module are "fail-open": DB or Inngest errors
 * are caught and warn-logged but never thrown back to callers. Counter drift
 * is reconciled by the weekly `cron/usage.reconcile` job. The quota gate is
 * the only function that surfaces failure as a boolean result (`ok: false`).
 */

import type { User } from "grammy/types";
import { and, asc, eq, isNull, max, sql } from "drizzle-orm";
import {
  conversations as convTable,
  db,
  documents,
  owners,
  subscriptions,
  tenantBots,
  tenants,
} from "@tg-business/db";
import {
  effectivePlan,
  planLimits,
  type PlanKey,
  type SubscriptionStatus,
} from "./plans";
import { inngest } from "../inngest/client";
import { logger } from "./logger";

const TRIAL_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Profile capture
// ---------------------------------------------------------------------------

/**
 * Upsert the `owners` row from a Telegram `User`. Refreshes identity
 * (firstName/lastName/username/languageCode/isPremium) AND activity columns
 * (lastActiveAt + updatedAt). Idempotent — safe to call on every owner
 * interaction.
 *
 * If the row does not yet exist, INSERT with sensible defaults:
 *   - subscriptionStatus='trialing' (schema default)
 *   - trialEndsAt stays NULL (only set by startTrialOnFirstBot)
 *
 * Fail-open: DB errors are caught + warn-logged, never thrown.
 */
export async function upsertOwnerProfile(from: User): Promise<void> {
  try {
    const telegramUserId = String(from.id);
    const now = new Date();
    const firstName = from.first_name ?? null;
    const lastName = from.last_name ?? null;
    const username = from.username ?? null;
    const languageCode = from.language_code ?? null;
    const isPremium = from.is_premium === true;

    await db
      .insert(owners)
      .values({
        telegramUserId,
        firstName,
        lastName,
        username,
        languageCode,
        isPremium,
        lastActiveAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: owners.telegramUserId,
        set: {
          firstName,
          lastName,
          username,
          languageCode,
          isPremium,
          lastActiveAt: now,
          updatedAt: now,
        },
      });
  } catch (err) {
    logger.warn(
      { err, userId: from.id },
      "upsertOwnerProfile failed (fail-open)",
    );
  }
}

/**
 * Lightweight activity bump for `(lastActiveAt, updatedAt)` only. Cheaper
 * than {@link upsertOwnerProfile} when only activity needs refreshing.
 * Fail-open.
 */
export async function touchOwner(telegramUserId: string): Promise<void> {
  try {
    const now = new Date();
    await db
      .update(owners)
      .set({ lastActiveAt: now, updatedAt: now })
      .where(eq(owners.telegramUserId, telegramUserId));
  } catch (err) {
    logger.warn({ err, telegramUserId }, "touchOwner failed (fail-open)");
  }
}

/**
 * Called once when the owner's first bot is successfully created
 * (`POST /api/bots` succeeds for the first time for that owner). Sets
 * `trial_ends_at = now + 14 days` IFF still null, then fires
 * `owner/first.bot.created` so the welcome DM goes out.
 *
 * Idempotent: re-running does NOT reset `trial_ends_at` and does NOT
 * re-fire the Inngest event (a row with `trial_ends_at` already set
 * means we have already announced trial start).
 */
export async function startTrialOnFirstBot(
  telegramUserId: string,
): Promise<void> {
  try {
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * MS_PER_DAY);

    // UPDATE only when trial_ends_at IS NULL. RETURNING tells us whether the
    // write actually happened so we only fire the event once.
    const updated = await db
      .update(owners)
      .set({
        trialEndsAt,
        subscriptionStatus: "trialing",
        updatedAt: now,
      })
      .where(
        and(
          eq(owners.telegramUserId, telegramUserId),
          isNull(owners.trialEndsAt),
        ),
      )
      .returning({ telegramUserId: owners.telegramUserId });

    if (updated.length === 0) {
      return;
    }

    try {
      await inngest.send({
        name: "owner/first.bot.created",
        data: { ownerTelegramUserId: telegramUserId },
      });
    } catch (err) {
      logger.warn(
        { err, telegramUserId },
        "owner/first.bot.created inngest send failed (fail-open)",
      );
    }
  } catch (err) {
    logger.warn(
      { err, telegramUserId },
      "startTrialOnFirstBot failed (fail-open)",
    );
  }
}

// ---------------------------------------------------------------------------
// Atomic counter helpers
// ---------------------------------------------------------------------------

async function bumpCounter(
  telegramUserId: string,
  column: "botCount" | "docCount" | "messagesThisPeriod",
  delta: 1 | -1,
  label: string,
): Promise<void> {
  try {
    const colName =
      column === "botCount"
        ? "bot_count"
        : column === "docCount"
          ? "doc_count"
          : "messages_this_period";
    // Atomic SQL increment / decrement. GREATEST guards against drift
    // sending the counter negative.
    const expr =
      delta === 1
        ? sql.raw(`${colName} + 1`)
        : sql.raw(`GREATEST(${colName} - 1, 0)`);
    await db
      .update(owners)
      .set({ [column]: expr, updatedAt: new Date() })
      .where(eq(owners.telegramUserId, telegramUserId));
  } catch (err) {
    logger.warn({ err, telegramUserId }, `${label} failed (fail-open)`);
  }
}

export async function incrementBotCount(telegramUserId: string): Promise<void> {
  await bumpCounter(telegramUserId, "botCount", 1, "incrementBotCount");
}

export async function decrementBotCount(telegramUserId: string): Promise<void> {
  await bumpCounter(telegramUserId, "botCount", -1, "decrementBotCount");
}

export async function incrementDocCount(telegramUserId: string): Promise<void> {
  await bumpCounter(telegramUserId, "docCount", 1, "incrementDocCount");
}

export async function decrementDocCount(telegramUserId: string): Promise<void> {
  await bumpCounter(telegramUserId, "docCount", -1, "decrementDocCount");
}

export async function incrementMessageCount(
  telegramUserId: string,
): Promise<void> {
  await bumpCounter(
    telegramUserId,
    "messagesThisPeriod",
    1,
    "incrementMessageCount",
  );
}

/** Rollback counter after an AI failure. */
export async function decrementMessageCount(
  telegramUserId: string,
): Promise<void> {
  await bumpCounter(
    telegramUserId,
    "messagesThisPeriod",
    -1,
    "decrementMessageCount",
  );
}

/**
 * Reset `messages_this_period` to 0 at a subscription period boundary
 * and set `period_started_at = periodStartedAt`. Called from the renewal
 * handler. Fail-open.
 */
export async function resetMessageCount(
  telegramUserId: string,
  periodStartedAt: Date,
): Promise<void> {
  try {
    await db
      .update(owners)
      .set({
        messagesThisPeriod: 0,
        periodStartedAt,
        updatedAt: new Date(),
      })
      .where(eq(owners.telegramUserId, telegramUserId));
  } catch (err) {
    logger.warn(
      { err, telegramUserId },
      "resetMessageCount failed (fail-open)",
    );
  }
}

// ---------------------------------------------------------------------------
// Quota gate
// ---------------------------------------------------------------------------

export type QuotaKind = "bot" | "doc" | "message";

export interface QuotaCheckResult {
  ok: boolean;
  /** Effective plan at the time of the check (null when lapsed). */
  plan: PlanKey | null;
  used: number;
  limit: number;
  reason?: "lapsed" | "banned" | "at_cap";
}

interface OwnerSubsRow {
  plan: PlanKey;
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
}

interface OwnerWithSubs {
  isBanned: boolean;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
  botCount: number;
  messagesThisPeriod: number;
  subs: OwnerSubsRow[];
}

async function loadOwnerWithSubs(
  telegramUserId: string,
): Promise<OwnerWithSubs | null> {
  const ownerRow = await db.query.owners.findFirst({
    where: eq(owners.telegramUserId, telegramUserId),
    columns: {
      isBanned: true,
      subscriptionStatus: true,
      trialEndsAt: true,
      botCount: true,
      messagesThisPeriod: true,
    },
  });
  if (!ownerRow) return null;

  const subs = await db.query.subscriptions.findMany({
    where: eq(subscriptions.ownerTelegramUserId, telegramUserId),
    columns: {
      plan: true,
      status: true,
      currentPeriodEnd: true,
    },
  });

  return {
    isBanned: ownerRow.isBanned,
    subscriptionStatus: ownerRow.subscriptionStatus,
    trialEndsAt: ownerRow.trialEndsAt,
    botCount: ownerRow.botCount,
    messagesThisPeriod: ownerRow.messagesThisPeriod,
    subs: subs.map((s) => ({
      plan: s.plan,
      status: s.status,
      currentPeriodEnd: s.currentPeriodEnd,
    })),
  };
}

/**
 * Check whether the owner may perform an action of `kind`.
 *
 * Effective plan is computed via {@link effectivePlan} from the owner row
 * plus all their subscription rows. Banned + lapsed owners short-circuit
 * before any cap math.
 */
export async function checkQuota(
  ownerTelegramUserId: string,
  kind: QuotaKind,
  options?: { botId?: string },
): Promise<QuotaCheckResult> {
  try {
    const ownerData = await loadOwnerWithSubs(ownerTelegramUserId);
    if (!ownerData) {
      return { ok: false, plan: null, used: 0, limit: 0, reason: "lapsed" };
    }

    if (ownerData.isBanned) {
      return { ok: false, plan: null, used: 0, limit: 0, reason: "banned" };
    }

    const eff = effectivePlan({
      subscriptionStatus: ownerData.subscriptionStatus,
      trialEndsAt: ownerData.trialEndsAt,
      subscriptions: ownerData.subs,
    });

    if (eff.plan === null) {
      return { ok: false, plan: null, used: 0, limit: 0, reason: "lapsed" };
    }

    const limits = planLimits(eff.plan);

    if (kind === "bot") {
      const used = ownerData.botCount;
      const limit = limits.maxBots;
      return {
        ok: used < limit,
        plan: eff.plan,
        used,
        limit,
        ...(used < limit ? {} : { reason: "at_cap" as const }),
      };
    }

    if (kind === "message") {
      const used = ownerData.messagesThisPeriod;
      const limit = limits.maxMessagesPerPeriod;
      return {
        ok: used < limit,
        plan: eff.plan,
        used,
        limit,
        ...(used < limit ? {} : { reason: "at_cap" as const }),
      };
    }

    // kind === "doc" — per-bot doc count.
    if (!options?.botId) {
      logger.warn(
        { ownerTelegramUserId },
        "checkQuota(doc) called without botId; treating as at_cap",
      );
      return {
        ok: false,
        plan: eff.plan,
        used: 0,
        limit: limits.maxDocsPerBot,
        reason: "at_cap",
      };
    }

    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(documents)
      .where(eq(documents.tenantBotId, options.botId));
    const used = rows[0]?.count ?? 0;
    const limit = limits.maxDocsPerBot;
    return {
      ok: used < limit,
      plan: eff.plan,
      used,
      limit,
      ...(used < limit ? {} : { reason: "at_cap" as const }),
    };
  } catch (err) {
    logger.warn(
      { err, ownerTelegramUserId, kind },
      "checkQuota failed (fail-closed for safety)",
    );
    // Fail closed on unexpected errors — better to block one creation than
    // let owners blow past their cap because the DB hiccuped.
    return { ok: false, plan: null, used: 0, limit: 0, reason: "lapsed" };
  }
}

// ---------------------------------------------------------------------------
// Plan reconciliation
// ---------------------------------------------------------------------------

/**
 * Read the owner row + all their subscriptions, recompute the effective plan,
 * and write the denormalized `current_plan` / `subscription_status` /
 * `subscription_renews_at` columns. Idempotent; safe after every billing
 * event. Returns the new effective plan info for the caller.
 */
export async function recomputeEffectivePlan(
  ownerTelegramUserId: string,
): Promise<{ plan: PlanKey | null; status: SubscriptionStatus }> {
  try {
    const ownerData = await loadOwnerWithSubs(ownerTelegramUserId);
    if (!ownerData) {
      return { plan: null, status: "lapsed" };
    }

    const eff = effectivePlan({
      subscriptionStatus: ownerData.subscriptionStatus,
      trialEndsAt: ownerData.trialEndsAt,
      subscriptions: ownerData.subs,
    });

    // Pick the renews-at as the latest currentPeriodEnd among "live" subs
    // (active or canceled-still-in-period). Null when no live paid subs.
    const now = new Date();
    const liveEnds = ownerData.subs
      .filter(
        (s) =>
          s.status === "active" ||
          (s.status === "canceled" && s.currentPeriodEnd.getTime() > now.getTime()),
      )
      .map((s) => s.currentPeriodEnd.getTime());
    const renewsAt =
      liveEnds.length > 0 ? new Date(Math.max(...liveEnds)) : null;

    // Resolve the persisted subscription_status. effectivePlan returns
    // "trialing" | "active" | "canceled" | "lapsed".
    const newStatus: SubscriptionStatus = eff.plan === null ? "lapsed" : eff.status;

    await db
      .update(owners)
      .set({
        currentPlan: eff.plan,
        subscriptionStatus: newStatus,
        subscriptionRenewsAt: renewsAt,
        updatedAt: new Date(),
      })
      .where(eq(owners.telegramUserId, ownerTelegramUserId));

    return { plan: eff.plan, status: newStatus };
  } catch (err) {
    logger.warn(
      { err, ownerTelegramUserId },
      "recomputeEffectivePlan failed (fail-open)",
    );
    return { plan: null, status: "lapsed" };
  }
}

// ---------------------------------------------------------------------------
// Quota enforcement (over_quota_at reconciliation)
// ---------------------------------------------------------------------------

export interface QuotaSelectionBot {
  id: string;
  createdAt: Date;
  /** max(conversations.last_message_at) for this bot; null if no traffic. */
  lastActiveAt: Date | null;
  currentlyOverQuota: boolean;
}

/**
 * Pure helper: given a list of bots with their last-activity timestamps and
 * a cap, return the IDs that should be active and the IDs that should be
 * over-quota.
 *
 * Selection rule (locked in SUBSCRIPTION.md):
 *   1. Most-recently-active first (by `lastActiveAt`).
 *   2. Tiebreak: oldest `createdAt` wins.
 *   3. Bots with `lastActiveAt = null` are deprioritized (treated as least
 *      recent).
 *   4. When everything else ties, prefer keeping currently-active bots
 *      active — minimizes churn / spurious pause-unpause DMs.
 */
export function selectActiveBots(
  bots: ReadonlyArray<QuotaSelectionBot>,
  maxActive: number,
): { active: string[]; overQuota: string[] } {
  if (maxActive <= 0) {
    return { active: [], overQuota: bots.map((b) => b.id) };
  }

  const sorted = [...bots].sort((a, b) => {
    // 1. lastActiveAt descending; null is least recent (sorts last).
    const aActive = a.lastActiveAt?.getTime() ?? null;
    const bActive = b.lastActiveAt?.getTime() ?? null;

    if (aActive !== bActive) {
      if (aActive === null) return 1;
      if (bActive === null) return -1;
      return bActive - aActive;
    }

    // 2. Stability tiebreak: prefer the currently-active bot. Reduces churn
    //    when ties (e.g. both lastActiveAt === null) would otherwise swap
    //    which bot stays active.
    if (a.currentlyOverQuota !== b.currentlyOverQuota) {
      return a.currentlyOverQuota ? 1 : -1;
    }

    // 3. createdAt ascending (oldest wins).
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const active = sorted.slice(0, maxActive).map((b) => b.id);
  const overQuota = sorted.slice(maxActive).map((b) => b.id);
  return { active, overQuota };
}

/**
 * Reconcile `tenant_bots.over_quota_at` for an owner against their current
 * effective plan.
 *
 * - Banned or lapsed owners: pause ALL bots.
 * - Otherwise: keep up to `plan.maxBots` bots active per the selection rule
 *   in {@link selectActiveBots}.
 *
 * Returns the bot IDs that were freshly cleared (newly active) and the IDs
 * that were freshly paused, so the caller can DM the owner.
 */
export async function enforceOwnerQuota(
  ownerTelegramUserId: string,
): Promise<{ activated: string[]; paused: string[] }> {
  try {
    const ownerData = await loadOwnerWithSubs(ownerTelegramUserId);
    if (!ownerData) {
      return { activated: [], paused: [] };
    }

    // Resolve owner's tenant. Owners can have at most one tenant (UNIQUE
    // constraint), but `tenants.telegram_owner_id` is text — we look up by
    // owner id and join through tenant rows to get the bots.
    const ownerTenants = await db.query.tenants.findMany({
      where: eq(tenants.telegramOwnerId, ownerTelegramUserId),
      columns: { id: true },
    });
    if (ownerTenants.length === 0) {
      return { activated: [], paused: [] };
    }
    const tenantIds = ownerTenants.map((t) => t.id);

    // Fetch the owner's bots with their last-activity timestamps.
    const botRows = await db
      .select({
        id: tenantBots.id,
        createdAt: tenantBots.createdAt,
        overQuotaAt: tenantBots.overQuotaAt,
        lastActiveAt: max(convTable.lastMessageAt),
      })
      .from(tenantBots)
      .leftJoin(
        convTable,
        eq(convTable.tenantId, tenantBots.tenantId),
      )
      .where(
        tenantIds.length === 1
          ? eq(tenantBots.tenantId, tenantIds[0]!)
          : sql`${tenantBots.tenantId} IN ${tenantIds}`,
      )
      .groupBy(tenantBots.id, tenantBots.createdAt, tenantBots.overQuotaAt);

    const bots: QuotaSelectionBot[] = botRows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      lastActiveAt: r.lastActiveAt,
      currentlyOverQuota: r.overQuotaAt !== null,
    }));

    if (bots.length === 0) {
      return { activated: [], paused: [] };
    }

    // Determine the cap.
    let maxActive: number;
    if (ownerData.isBanned) {
      maxActive = 0;
    } else {
      const eff = effectivePlan({
        subscriptionStatus: ownerData.subscriptionStatus,
        trialEndsAt: ownerData.trialEndsAt,
        subscriptions: ownerData.subs,
      });
      maxActive = eff.plan === null ? 0 : planLimits(eff.plan).maxBots;
    }

    const { active, overQuota } = selectActiveBots(bots, maxActive);
    const activeSet = new Set(active);
    const overQuotaSet = new Set(overQuota);

    // Compute deltas relative to current state so the caller can DM accurately.
    const activated: string[] = [];
    const paused: string[] = [];
    for (const b of bots) {
      const wasOver = b.currentlyOverQuota;
      const willBeOver = overQuotaSet.has(b.id);
      if (wasOver && activeSet.has(b.id)) {
        activated.push(b.id);
      } else if (!wasOver && willBeOver) {
        paused.push(b.id);
      }
    }

    const now = new Date();
    // Apply the state changes. Two narrow updates rather than a CASE expr
    // to keep the SQL readable; over_quota_at flips are infrequent.
    if (activated.length > 0) {
      await db
        .update(tenantBots)
        .set({ overQuotaAt: null })
        .where(
          activated.length === 1
            ? eq(tenantBots.id, activated[0]!)
            : sql`${tenantBots.id} IN ${activated}`,
        );
    }
    if (paused.length > 0) {
      await db
        .update(tenantBots)
        .set({ overQuotaAt: now })
        .where(
          paused.length === 1
            ? eq(tenantBots.id, paused[0]!)
            : sql`${tenantBots.id} IN ${paused}`,
        );
    }

    return { activated, paused };
  } catch (err) {
    logger.warn(
      { err, ownerTelegramUserId },
      "enforceOwnerQuota failed (fail-open)",
    );
    return { activated: [], paused: [] };
  }
}

// ---------------------------------------------------------------------------
// Tap-to-swap
// ---------------------------------------------------------------------------

/**
 * Owner picks a different bot as primary. Clears `over_quota_at` on the
 * target and (to fit the cap) pauses the least-recently-used currently
 * active bot.
 *
 * Throws if the target bot does not belong to the owner. No-op if the
 * target bot is already active and the cap is not exceeded.
 */
export async function swapPrimaryBot(
  ownerTelegramUserId: string,
  targetBotId: string,
): Promise<void> {
  // Ownership check via the tenants table.
  const ownerTenants = await db.query.tenants.findMany({
    where: eq(tenants.telegramOwnerId, ownerTelegramUserId),
    columns: { id: true },
  });
  if (ownerTenants.length === 0) {
    throw new Error("Owner has no tenant");
  }
  const tenantIds = new Set(ownerTenants.map((t) => t.id));

  const targetRow = await db.query.tenantBots.findFirst({
    where: eq(tenantBots.id, targetBotId),
    columns: { id: true, tenantId: true, overQuotaAt: true },
  });
  if (!targetRow || !tenantIds.has(targetRow.tenantId)) {
    throw new Error("Bot not owned by this owner");
  }

  if (targetRow.overQuotaAt === null) {
    // Already active — nothing to swap.
    return;
  }

  // Resolve cap from the effective plan.
  const ownerData = await loadOwnerWithSubs(ownerTelegramUserId);
  if (!ownerData) {
    throw new Error("Owner not found");
  }
  let maxActive = 0;
  if (!ownerData.isBanned) {
    const eff = effectivePlan({
      subscriptionStatus: ownerData.subscriptionStatus,
      trialEndsAt: ownerData.trialEndsAt,
      subscriptions: ownerData.subs,
    });
    maxActive = eff.plan === null ? 0 : planLimits(eff.plan).maxBots;
  }

  if (maxActive <= 0) {
    throw new Error("No active plan — cannot activate a bot");
  }

  // Count currently-active bots for this owner and find the LRU among them
  // (oldest lastActiveAt; null counts as least recent).
  const tenantIdList = [...tenantIds];
  const botRows = await db
    .select({
      id: tenantBots.id,
      overQuotaAt: tenantBots.overQuotaAt,
      lastActiveAt: max(convTable.lastMessageAt),
    })
    .from(tenantBots)
    .leftJoin(convTable, eq(convTable.tenantId, tenantBots.tenantId))
    .where(
      tenantIdList.length === 1
        ? eq(tenantBots.tenantId, tenantIdList[0]!)
        : sql`${tenantBots.tenantId} IN ${tenantIdList}`,
    )
    .groupBy(tenantBots.id, tenantBots.overQuotaAt)
    .orderBy(asc(tenantBots.createdAt));

  const activeBots = botRows.filter((b) => b.overQuotaAt === null);
  const now = new Date();

  // If activating the target wouldn't exceed the cap, just clear it.
  if (activeBots.length < maxActive) {
    await db
      .update(tenantBots)
      .set({ overQuotaAt: null })
      .where(eq(tenantBots.id, targetBotId));
    return;
  }

  // Otherwise pause the LRU active bot first.
  const lru = [...activeBots].sort((a, b) => {
    const aActive = a.lastActiveAt?.getTime() ?? -Infinity;
    const bActive = b.lastActiveAt?.getTime() ?? -Infinity;
    return aActive - bActive;
  })[0];

  if (lru) {
    await db
      .update(tenantBots)
      .set({ overQuotaAt: now })
      .where(eq(tenantBots.id, lru.id));
  }

  await db
    .update(tenantBots)
    .set({ overQuotaAt: null })
    .where(eq(tenantBots.id, targetBotId));
}
