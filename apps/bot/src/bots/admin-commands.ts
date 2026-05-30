/**
 * Admin commands mounted on the onboarding bot. Gated by
 * `ADMIN_TELEGRAM_USER_ID` — non-admins get a silent "Not authorized."
 * (the locked design in SUBSCRIPTION.md treats this surface as private
 * to the SaaS operator).
 *
 * Commands:
 *   /owner <id_or_@username>       — read-only owner profile + subs + bots
 *   /refund <chargeId>             — refund + cancel auto-renew + fire event
 *   /grant_comp <ownerId> <plan>   — insert synthetic comp subscription row
 *   /revoke_comp <ownerId>         — delete comp subscription rows + recompute plan
 *   /ban <ownerId>                 — flag is_banned, fire owner/banned event
 *   /unban <ownerId>               — clear is_banned (no auto-resub)
 *
 * No side effects at import time. All Telegram API + DB work happens
 * inside handler bodies so this module is safe to import from anywhere.
 *
 * See SUBSCRIPTION.md "Admin Surface" + "Refund" + "Bans" +
 * "Complimentary Subscriptions".
 */

import type { Bot, Context } from "grammy";
import { randomUUID } from "crypto";
import { and, eq, or } from "drizzle-orm";
import {
  db,
  owners,
  subscriptions,
  tenants,
  tenantBots,
} from "@tg-business/db";
import { markOwnerBanned, markOwnerUnbanned } from "../lib/banned";
import { recomputeEffectivePlan } from "../lib/owners";
import { inngest } from "../inngest/client";
import { cancelStarSubscription } from "../inngest/handlers/_telegram";
import { logger } from "../lib/logger";
import {
  ADMIN_BAN_APPLIED,
  ADMIN_COMP_GRANTED,
  ADMIN_COMP_NONE,
  ADMIN_COMP_REVOKED,
  ADMIN_OWNER_NOT_FOUND,
  ADMIN_REFUND_SUCCESS,
  ADMIN_UNAUTHORIZED,
  ADMIN_UNBAN_APPLIED,
  adminOwnerSummary,
} from "../lib/text";

type OwnerRow = typeof owners.$inferSelect;
type SubscriptionRow = typeof subscriptions.$inferSelect;

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

/**
 * True only when ADMIN_TELEGRAM_USER_ID is set AND the caller's id matches.
 * If the env var is not configured, no caller is admin — which means the
 * admin surface is effectively disabled. Safer default than allow-all.
 */
export function isAdmin(ctx: Context): boolean {
  const allowedId = process.env.ADMIN_TELEGRAM_USER_ID;
  if (!allowedId) return false;
  const fromId = ctx.from?.id;
  if (fromId === undefined) return false;
  return String(fromId) === allowedId;
}

/**
 * Validate the single numeric `<ownerId>` argument used by id-only admin
 * commands (comps are addressed by Telegram user id, never `@handle`).
 * Returns the trimmed id, or null when missing / non-numeric / has extra args.
 */
export function parseOwnerIdArg(raw: string | undefined): string | null {
  const arg = (raw ?? "").trim();
  return /^\d+$/.test(arg) ? arg : null;
}

/**
 * Resolve an owner by either numeric telegram_user_id or `@username`.
 * For bare strings (no `@` prefix, not all-digits), tries both columns.
 *
 * Returns the first match. Username matching strips a leading `@` to
 * tolerate operators who paste it either way.
 */
async function findOwner(arg: string): Promise<OwnerRow | null> {
  const trimmed = arg.trim();
  if (trimmed.length === 0) return null;

  // Numeric → exact match on telegram_user_id.
  if (/^\d+$/.test(trimmed)) {
    const row = await db.query.owners.findFirst({
      where: eq(owners.telegramUserId, trimmed),
    });
    return row ?? null;
  }

  // @handle (or bare handle) → match on username (handle without @).
  const handle = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;

  // Best-effort: try BOTH columns so `/owner alice` works whether `alice`
  // is the @handle or a numeric-looking-but-not username.
  const row = await db.query.owners.findFirst({
    where: or(
      eq(owners.username, handle),
      eq(owners.telegramUserId, trimmed),
    ),
  });
  return row ?? null;
}

function formatDate(d: Date | null): string {
  if (d === null) return "—";
  return d.toISOString().slice(0, 10);
}

function formatSubscriptionLine(s: SubscriptionRow): string {
  const comp = s.isComplimentary ? " (comp)" : "";
  return `• ${s.plan} — ${s.status} — ends ${formatDate(s.currentPeriodEnd)}${comp}`;
}

function formatBotLine(b: {
  botUsername: string | null;
  status: "active" | "paused" | "revoked";
  overQuotaAt: Date | null;
}): string {
  const handle = b.botUsername ? `@${b.botUsername}` : "(unknown)";
  const over = b.overQuotaAt !== null ? " 🚫over-quota" : "";
  return `• ${handle} — ${b.status}${over}`;
}

/**
 * Render the /owner response. Pulled out for testability — pure-ish:
 * takes the already-loaded data and produces the HTML string.
 */
function renderOwnerSummary(args: {
  owner: OwnerRow;
  subs: ReadonlyArray<SubscriptionRow>;
  bots: ReadonlyArray<{
    botUsername: string | null;
    status: "active" | "paused" | "revoked";
    overQuotaAt: Date | null;
  }>;
}): string {
  const { owner, subs, bots } = args;
  const head = adminOwnerSummary({
    ownerId: owner.telegramUserId,
    username: owner.username,
    plan: owner.currentPlan,
    status: owner.subscriptionStatus,
    botCount: owner.botCount,
    lifetimeStarsSpent: owner.lifetimeStarsSpent,
  });

  const subsBlock =
    subs.length === 0
      ? "Subscriptions: none"
      : `Subscriptions:\n${subs.map(formatSubscriptionLine).join("\n")}`;

  const botsBlock =
    bots.length === 0
      ? "Bots: none"
      : `Bots:\n${bots.map(formatBotLine).join("\n")}`;

  const bannedLine = owner.isBanned ? "\n\n🚫 <b>BANNED</b>" : "";

  return `${head}\n\n${subsBlock}\n\n${botsBlock}${bannedLine}`;
}

/**
 * Load the owner's bot rows via their tenant. Returns [] when the owner
 * has no tenant row yet (pre-onboarding).
 */
async function loadOwnerBots(ownerTelegramUserId: string): Promise<
  Array<{
    botUsername: string | null;
    status: "active" | "paused" | "revoked";
    overQuotaAt: Date | null;
  }>
> {
  const tenantRows = await db.query.tenants.findMany({
    where: eq(tenants.telegramOwnerId, ownerTelegramUserId),
    columns: { id: true },
  });
  if (tenantRows.length === 0) return [];
  const tenantId = tenantRows[0]?.id;
  if (!tenantId) return [];

  const botRows = await db.query.tenantBots.findMany({
    where: eq(tenantBots.tenantId, tenantId),
    columns: {
      botUsername: true,
      status: true,
      overQuotaAt: true,
    },
  });
  return botRows;
}

/**
 * Issue a refund via Bot API. Returns true on a 2xx response. Fail-open:
 * errors are logged + return false so the caller can surface a friendly
 * message without a stack trace.
 */
async function refundStarPayment(args: {
  ownerTelegramUserId: string;
  telegramPaymentChargeId: string;
}): Promise<boolean> {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    logger.error("BOT_TOKEN missing — cannot refund star payment");
    return false;
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/refundStarPayment`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: Number(args.ownerTelegramUserId),
          telegram_payment_charge_id: args.telegramPaymentChargeId,
        }),
      },
    );
    if (!res.ok) {
      logger.warn(
        {
          status: res.status,
          ownerTelegramUserId: args.ownerTelegramUserId,
          telegramPaymentChargeId: args.telegramPaymentChargeId,
        },
        "refundStarPayment failed",
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(
      {
        err,
        ownerTelegramUserId: args.ownerTelegramUserId,
        telegramPaymentChargeId: args.telegramPaymentChargeId,
      },
      "refundStarPayment threw",
    );
    return false;
  }
}

/**
 * Ensure an `owners` row exists. Used by /grant_comp so comping a never-seen
 * Telegram id doesn't bounce off the FK constraint on `subscriptions.owner_telegram_user_id`.
 * Idempotent.
 */
async function ensureOwnerRow(telegramUserId: string): Promise<void> {
  await db
    .insert(owners)
    .values({ telegramUserId })
    .onConflictDoNothing({ target: owners.telegramUserId });
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Mount the admin commands on the onboarding bot. Call once, after the
 * conversations + session middleware are installed (the admin commands
 * themselves don't depend on conversation state, but ordering keeps the
 * dispatcher chain clean).
 */
export function attachAdminCommands(bot: Bot<Context>): void {
  // /owner <id_or_@username>
  bot.command("owner", async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply(ADMIN_UNAUTHORIZED);
      return;
    }
    const arg =
      (typeof ctx.match === "string" ? ctx.match : "")?.trim() ?? "";
    if (arg.length === 0) {
      await ctx.reply("Usage: /owner <id or @username>");
      return;
    }
    try {
      const owner = await findOwner(arg);
      if (!owner) {
        await ctx.reply(ADMIN_OWNER_NOT_FOUND);
        return;
      }

      const subs = await db.query.subscriptions.findMany({
        where: eq(subscriptions.ownerTelegramUserId, owner.telegramUserId),
      });
      const bots = await loadOwnerBots(owner.telegramUserId);

      const summary = renderOwnerSummary({ owner, subs, bots });
      await ctx.reply(summary, { parse_mode: "HTML" });
    } catch (err) {
      logger.warn({ err, arg }, "/owner failed");
      await ctx.reply("Lookup failed — see server logs.");
    }
  });

  // /refund <chargeId>
  bot.command("refund", async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply(ADMIN_UNAUTHORIZED);
      return;
    }
    const chargeId =
      (typeof ctx.match === "string" ? ctx.match : "")?.trim() ?? "";
    if (chargeId.length === 0) {
      await ctx.reply("Usage: /refund <chargeId>");
      return;
    }

    try {
      const subRow = await db.query.subscriptions.findFirst({
        where: eq(subscriptions.telegramPaymentChargeId, chargeId),
      });
      if (!subRow) {
        await ctx.reply(ADMIN_OWNER_NOT_FOUND);
        return;
      }

      // 1. Refund the charge. Logged on failure but we still attempt to
      //    cancel auto-renew so we don't loop on the next renewal.
      const refundedOk = await refundStarPayment({
        ownerTelegramUserId: subRow.ownerTelegramUserId,
        telegramPaymentChargeId: chargeId,
      });

      // 2. Critical: stop auto-renew so Telegram doesn't recharge.
      const canceledOk = await cancelStarSubscription({
        ownerTelegramUserId: subRow.ownerTelegramUserId,
        telegramPaymentChargeId: chargeId,
      });

      // 3. Fire downstream event — the inngest handler does the ledger row,
      //    DB transitions, and downstream lapse cascade.
      await inngest.send({
        name: "subscription/refunded",
        data: {
          ownerTelegramUserId: subRow.ownerTelegramUserId,
          telegramPaymentChargeId: chargeId,
        },
      });

      if (!refundedOk || !canceledOk) {
        await ctx.reply(
          `⚠️ Partial: refund=${refundedOk ? "ok" : "fail"} cancel=${canceledOk ? "ok" : "fail"}. Event fired anyway.`,
        );
        return;
      }
      await ctx.reply(ADMIN_REFUND_SUCCESS);
    } catch (err) {
      logger.warn({ err, chargeId }, "/refund failed");
      await ctx.reply("Refund failed — see server logs.");
    }
  });

  // /grant_comp <ownerId> <pro|business>
  bot.command("grant_comp", async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply(ADMIN_UNAUTHORIZED);
      return;
    }
    const raw = (typeof ctx.match === "string" ? ctx.match : "")?.trim() ?? "";
    const parts = raw.split(/\s+/).filter((p) => p.length > 0);
    if (parts.length !== 2) {
      await ctx.reply("Usage: /grant_comp <ownerId> <pro|business>");
      return;
    }
    const ownerIdArg = parts[0]!;
    const planArg = parts[1]!.toLowerCase();
    if (planArg !== "pro" && planArg !== "business") {
      await ctx.reply("Plan must be 'pro' or 'business'.");
      return;
    }

    try {
      // Numeric owner id only — comps are issued by id, not by handle, to
      // avoid collisions on stale @handle values.
      if (!/^\d+$/.test(ownerIdArg)) {
        await ctx.reply("ownerId must be numeric (Telegram user id).");
        return;
      }

      // Make sure the owners row exists so the FK on subscriptions holds.
      await ensureOwnerRow(ownerIdArg);

      const farFuture = new Date("2099-12-31T23:59:59Z");
      const compChargeId = `comp:${randomUUID()}`;

      await db.insert(subscriptions).values({
        ownerTelegramUserId: ownerIdArg,
        plan: planArg,
        status: "active",
        telegramPaymentChargeId: compChargeId,
        starsPerPeriod: 0,
        currentPeriodEnd: farFuture,
        isComplimentary: true,
      });

      await recomputeEffectivePlan(ownerIdArg);

      await ctx.reply(ADMIN_COMP_GRANTED);
    } catch (err) {
      logger.warn({ err, ownerIdArg, planArg }, "/grant_comp failed");
      await ctx.reply("Grant failed — see server logs.");
    }
  });

  // /revoke_comp <ownerId> — delete the owner's complimentary subscription
  // row(s), then recompute their effective plan. Deletion (not cancel) is
  // required: a comp's currentPeriodEnd is year-2099, and the cancel flow
  // only flips status→canceled without moving currentPeriodEnd, so a
  // "canceled" comp still counts as live in effectivePlan. Removing the row
  // is the only way to actually drop the entitlement.
  bot.command("revoke_comp", async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply(ADMIN_UNAUTHORIZED);
      return;
    }
    const ownerIdArg = parseOwnerIdArg(
      typeof ctx.match === "string" ? ctx.match : "",
    );
    if (!ownerIdArg) {
      await ctx.reply(
        "Usage: /revoke_comp <ownerId>   (numeric Telegram user id)",
      );
      return;
    }

    try {
      const deleted = await db
        .delete(subscriptions)
        .where(
          and(
            eq(subscriptions.ownerTelegramUserId, ownerIdArg),
            eq(subscriptions.isComplimentary, true),
          ),
        )
        .returning({ id: subscriptions.id });

      if (deleted.length === 0) {
        await ctx.reply(ADMIN_COMP_NONE);
        return;
      }

      // Refresh owners.current_plan / status from the remaining rows (a real
      // pro/business sub, a canceled tail, or none → lapsed).
      await recomputeEffectivePlan(ownerIdArg);

      await ctx.reply(ADMIN_COMP_REVOKED);
    } catch (err) {
      logger.warn({ err, ownerIdArg }, "/revoke_comp failed");
      await ctx.reply("Revoke failed — see server logs.");
    }
  });

  // /ban <ownerId>
  bot.command("ban", async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply(ADMIN_UNAUTHORIZED);
      return;
    }
    const ownerIdArg =
      (typeof ctx.match === "string" ? ctx.match : "")?.trim() ?? "";
    if (ownerIdArg.length === 0 || !/^\d+$/.test(ownerIdArg)) {
      await ctx.reply("Usage: /ban <ownerId>   (numeric Telegram user id)");
      return;
    }

    try {
      const result = await db
        .update(owners)
        .set({ isBanned: true, updatedAt: new Date() })
        .where(eq(owners.telegramUserId, ownerIdArg))
        .returning({ telegramUserId: owners.telegramUserId });

      if (result.length === 0) {
        await ctx.reply(ADMIN_OWNER_NOT_FOUND);
        return;
      }

      // Cache hot-path lookup so the next tenant webhook for this
      // owner's bots short-circuits in O(1) without a DB round-trip.
      markOwnerBanned(ownerIdArg);

      // owner/banned handler: cancels all active subs + pauses all bots.
      await inngest.send({
        name: "owner/banned",
        data: { ownerTelegramUserId: ownerIdArg },
      });

      await ctx.reply(ADMIN_BAN_APPLIED);
    } catch (err) {
      logger.warn({ err, ownerIdArg }, "/ban failed");
      await ctx.reply("Ban failed — see server logs.");
    }
  });

  // /unban <ownerId>
  bot.command("unban", async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply(ADMIN_UNAUTHORIZED);
      return;
    }
    const ownerIdArg =
      (typeof ctx.match === "string" ? ctx.match : "")?.trim() ?? "";
    if (ownerIdArg.length === 0 || !/^\d+$/.test(ownerIdArg)) {
      await ctx.reply("Usage: /unban <ownerId>   (numeric Telegram user id)");
      return;
    }

    try {
      const result = await db
        .update(owners)
        .set({ isBanned: false, updatedAt: new Date() })
        .where(eq(owners.telegramUserId, ownerIdArg))
        .returning({ telegramUserId: owners.telegramUserId });

      if (result.length === 0) {
        await ctx.reply(ADMIN_OWNER_NOT_FOUND);
        return;
      }

      // Mirror the ban-cache mutation: drop the owner from the in-
      // memory Set so the next webhook is no longer dropped at ingress.
      markOwnerUnbanned(ownerIdArg);

      // No auto-resub: owner must subscribe again per locked design.
      await ctx.reply(ADMIN_UNBAN_APPLIED);
    } catch (err) {
      logger.warn({ err, ownerIdArg }, "/unban failed");
      await ctx.reply("Unban failed — see server logs.");
    }
  });
}

// ---------------------------------------------------------------------------
// Test-only exports
// ---------------------------------------------------------------------------

/**
 * Internal helpers re-exported for unit tests. Not part of the public
 * surface — call sites in app code should NOT import these.
 */
export const __test = {
  isAdmin,
  parseOwnerIdArg,
  findOwner,
  renderOwnerSummary,
  formatSubscriptionLine,
  formatBotLine,
  formatDate,
};

// Suppress unused-symbol warnings for types imported solely for `$inferSelect`.
// (Drizzle's `$inferSelect` is referenced via types only.)
export type { OwnerRow, SubscriptionRow };
