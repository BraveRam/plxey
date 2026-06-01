import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { Bot } from "grammy";
import { eq, and, desc } from "drizzle-orm";
import { db, documents, tenants, tenantBots, businessConnections } from "@tg-business/db";
import {
  getOrCreateTenant,
  listBots,
  createBot,
  updateBot,
  deleteBot,
  listDocuments,
  deleteDocument,
  restartBot,
  toPublicBot,
  ownerForBotId,
} from "../lib/api";
import { restartErrorMessage } from "../lib/text";
import { isOwnerBanned } from "../lib/banned";
import { apiLimiter } from "../lib/redis";
import { clientIp } from "../lib/client-ip";
import { verifyInitData } from "../lib/telegram-auth";
import {
  checkQuota,
  decrementBotCount,
  decrementDocCount,
  incrementBotCount,
  incrementDocCount,
  startTrialOnFirstBot,
} from "../lib/owners";
import { detectMimeType } from "../bots/document-types";
import { checkDocumentLimits } from "../bots/document-limits";
import { ingestDocument, cancelDocumentIngest } from "../lib/doc-ingest";
import { getBotStats } from "../lib/analytics-stats";
import { getBillingSummary } from "../lib/billing-read";
import { getOnboardingBotUsername } from "../lib/bot-identity";
import {
  parseDateRange,
  getAdminMetrics,
  listAdminOwners,
  getAdminOwnerDetail,
} from "../lib/admin-metrics";
import { isAdminOwnerId } from "../bots/admin-commands";
import { banOwner, unbanOwner } from "../lib/owner-moderation";
import { registry } from "../bots/registry";
import { ownerDistinctId, track } from "../lib/analytics";
import { logger } from "../lib/logger";

// All Mini App analytics events share the `miniapp.` prefix so they're
// distinguishable from the bot-side `mgmt.`/`onboarding.` events. Helper
// keeps call sites terse and tags the bot group when relevant.
function trackMini(
  ownerId: string,
  event: string,
  botId?: string,
): void {
  track(ownerDistinctId(ownerId), `miniapp.${event}`, {}, botId ? { bot: botId } : {});
}

// `ownerId` is the Telegram user id proven via initData HMAC. Every route
// reads it from context — never from client-supplied body/query.
type ApiVariables = { ownerId: string };

export const api = new Hono<{ Variables: ApiVariables }>();

async function ownerForDocId(docId: string): Promise<string | null> {
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, docId),
    columns: { tenantId: true },
  });
  if (!doc) return null;
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, doc.tenantId),
    columns: { telegramOwnerId: true },
  });
  return tenant?.telegramOwnerId ?? null;
}

// CORS first so the browser preflight (OPTIONS) succeeds before any auth
// or rate-limit logic runs. Allowlist only the Mini App origin; never `*`
// (credentials/headers carry the signed initData).
api.use(
  "*",
  cors({
    origin: process.env.MINIAPP_ORIGIN ?? "",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
    maxAge: 86400,
  }),
);

// Per-source-IP rate limit on every /api/* route. Fail open on Redis
// errors so a transient Upstash blip doesn't take the admin surface
// offline.
api.use("*", async (c, next) => {
  const ip = clientIp({ get: (name) => c.req.header(name) });
  const rl = await apiLimiter()
    .limit(ip)
    .catch(() => ({ success: true } as { success: boolean }));
  if (!rl.success) return c.json({ error: "rate limit exceeded" }, 429);
  await next();
});

// Telegram Mini App auth. Requires `Authorization: tma <initData>`,
// verifies the HMAC against BOT_TOKEN, and stashes the proven owner id.
// The verified id supersedes any client-supplied userId/telegramOwnerId.
api.use("*", async (c, next) => {
  const auth = c.req.header("Authorization") ?? "";
  const initData = auth.startsWith("tma ") ? auth.slice(4) : "";
  const botToken = process.env.BOT_TOKEN ?? "";
  const result = verifyInitData(initData, botToken);
  if (!result.ok) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const ownerId = String(result.user.id);
  if (await isOwnerBanned(ownerId)) {
    return c.json({ error: "banned" }, 403);
  }
  c.set("ownerId", ownerId);
  await next();
});

// Assert the verified owner owns `botId`. Returns a Response to send on
// failure, or null when the caller is authorized.
async function requireBotOwner(
  c: Context<{ Variables: ApiVariables }>,
  botId: string,
): Promise<Response | null> {
  const owner = await ownerForBotId(botId);
  if (owner === null) return c.json({ error: "not found" }, 404);
  if (owner !== c.get("ownerId")) return c.json({ error: "forbidden" }, 403);
  return null;
}

// Assert the verified owner is the single configured admin. Fail-closed when
// ADMIN_TELEGRAM_USER_ID is unset (no caller is admin). Reuses the same pure
// check as the bot-command gate (`isAdmin` in bots/admin-commands.ts) so the
// two surfaces can never drift. Returns a 403 Response when denied, else null.
function requireAdmin(
  c: Context<{ Variables: ApiVariables }>,
): Response | null {
  if (!isAdminOwnerId(c.get("ownerId"), process.env.ADMIN_TELEGRAM_USER_ID)) {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

api.post("/tenants", async (c) => {
  const ownerId = c.get("ownerId");
  try {
    const tenant = await getOrCreateTenant(ownerId);
    return c.json(tenant);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

api.get("/bots", async (c) => {
  const ownerId = c.get("ownerId");
  const bots = await listBots(ownerId);
  // First call on app open — a reasonable "Mini App opened" proxy.
  trackMini(ownerId, "opened");
  return c.json(bots.map(toPublicBot));
});

api.post("/bots", async (c) => {
  const { token } = await c.req.json<{ token: string }>();
  if (!token) return c.json({ error: "token required" }, 400);
  const ownerId = c.get("ownerId");

  // Plan-cap quota gate. Mirrors the bot's /createbot conversation
  // (apps/bot/src/bots/onboarding.ts) so a lapsed owner can't sneak
  // bots in via the Mini App.
  const quota = await checkQuota(ownerId, "bot");
  if (!quota.ok) {
    return c.json({ error: "quota", reason: quota.reason }, 403);
  }

  try {
    const botRecord = await createBot(token, ownerId);

    // Counter + trial seeding mirror the bot-side conversation flow.
    // Without these, owners.bot_count stays at 0 (until the weekly
    // cron-usage-reconcile) and trial_ends_at never gets set — billing
    // UI shows wrong usage and trial-sweep can never lapse the owner.
    // startTrialOnFirstBot is a no-op once trial_ends_at is set.
    try {
      await incrementBotCount(ownerId);
      await startTrialOnFirstBot(ownerId);
    } catch (err) {
      logger.warn(
        { err, ownerId, botId: botRecord.id },
        "miniapp: counter/trial seed failed (fail-open)",
      );
    }

    // Register the webhook with Telegram so the new bot actually receives
    // updates. Mirrors the onboarding bot's create flow; the BotRegistry
    // lazy-loads the bot on its first incoming update. Without this, a
    // Mini App-created bot is dead (no updates ever delivered).
    const publicUrl = process.env.PUBLIC_URL;
    if (publicUrl) {
      try {
        const tmp = new Bot(token);
        await tmp.api.setWebhook(`${publicUrl}/webhook/tenant/${botRecord.id}`, {
          drop_pending_updates: true,
          secret_token: botRecord.webhookSecret,
        });
        logger.info({ botId: botRecord.id }, "miniapp: tenant webhook set");
      } catch (err) {
        logger.error({ err, botId: botRecord.id }, "miniapp: failed to set tenant webhook");
      }
    }

    trackMini(ownerId, "bot.created", botRecord.id);
    return c.json(toPublicBot(botRecord), 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 400);
  }
});

api.patch("/bots/:id", async (c) => {
  const id = c.req.param("id");
  const denied = await requireBotOwner(c, id);
  if (denied) return denied;

  const {
    status,
    systemPrompt,
    welcomeMessage,
    autoReadBusinessMessages,
    dailyUserAiReplyLimit,
    dailyCapReachedMessage,
  } = await c.req.json<{
    status?: string;
    systemPrompt?: string;
    welcomeMessage?: string | null;
    autoReadBusinessMessages?: boolean;
    dailyUserAiReplyLimit?: number | null;
    dailyCapReachedMessage?: string | null;
  }>();
  try {
    const updated = await updateBot(id, {
      status,
      systemPrompt,
      welcomeMessage,
      autoReadBusinessMessages,
      dailyUserAiReplyLimit,
      dailyCapReachedMessage,
    });
    // BotRegistry caches the loaded tenant bot's settings (system prompt,
    // welcome message, autoReadBusinessMessages, daily caps, status). The
    // bot-side toggles invalidate or mutate the cached entry directly; the
    // Mini App PATCH path must do the same or live updates won't take
    // effect until the next process restart.
    registry.invalidate(id);
    trackMini(c.get("ownerId"), "bot.updated", id);
    return c.json(toPublicBot(updated));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 404);
  }
});

// Re-validate the bot's token and re-establish its webhook, then reactivate.
// Mirrors the onboarding bot's Restart button. Returns 200 on success; maps
// the result-union failure reasons to a status + owner-facing message so the
// Mini App can surface it. See restartBot in lib/api.ts.
api.post("/bots/:id/restart", async (c) => {
  const id = c.req.param("id");
  const denied = await requireBotOwner(c, id);
  if (denied) return denied;
  const ownerId = c.get("ownerId");
  try {
    const result = await restartBot(id);
    // Force the registry to re-read on the next webhook (mirrors PATCH/DELETE).
    registry.invalidate(id);
    if (!result.ok) {
      trackMini(ownerId, "bot.restart.failed", id);
      const status =
        result.reason === "token_invalid"
          ? 422
          : result.reason === "rate_limited"
            ? 429
            : result.reason === "webhook_failed"
              ? 502
              : 500;
      return c.json(
        { error: restartErrorMessage(result.reason), reason: result.reason },
        status,
      );
    }
    trackMini(ownerId, "bot.restart", id);
    return c.json({ success: true, botUsername: result.botUsername });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      404,
    );
  }
});

api.delete("/bots/:id", async (c) => {
  const id = c.req.param("id");
  const denied = await requireBotOwner(c, id);
  if (denied) return denied;
  const ownerId = c.get("ownerId");
  try {
    await deleteBot(id);
    // Same invalidation contract as the PATCH path: a cached bot in
    // BotRegistry would otherwise keep serving webhooks after deletion.
    // The registry comment at apps/bot/src/bots/registry.ts:1173 makes
    // this the caller's responsibility.
    registry.invalidate(id);
    // Mirror the bot-side delete flow (apps/bot/src/bots/onboarding.ts)
    // so owners.bot_count stays accurate without waiting for the weekly
    // reconcile cron.
    try {
      await decrementBotCount(ownerId);
    } catch (err) {
      logger.warn(
        { err, ownerId, botId: id },
        "miniapp: decrementBotCount failed (fail-open)",
      );
    }
    trackMini(ownerId, "bot.deleted", id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 404);
  }
});

api.get("/bots/:id/analytics", async (c) => {
  const id = c.req.param("id");
  const denied = await requireBotOwner(c, id);
  if (denied) return denied;
  const stats = await getBotStats(id);
  trackMini(c.get("ownerId"), "analytics.viewed", id);
  return c.json(stats);
});

api.get("/bots/:id/permissions", async (c) => {
  const id = c.req.param("id");
  const denied = await requireBotOwner(c, id);
  if (denied) return denied;
  // Match the bot's active-connection selection: the enabled connection,
  // freshest first. A plain findFirst could return a stale/disabled row.
  const conn = await db.query.businessConnections.findFirst({
    where: and(
      eq(businessConnections.tenantBotId, id),
      eq(businessConnections.isEnabled, true),
    ),
    orderBy: [desc(businessConnections.lastSyncedAt)],
    columns: { rights: true, isEnabled: true, lastSyncedAt: true },
  });
  return c.json({
    connected: !!conn,
    isEnabled: conn?.isEnabled ?? false,
    rights: conn?.rights ?? null,
    lastSyncedAt: conn?.lastSyncedAt?.toISOString() ?? null,
  });
});

// Lightweight identity probe for the Mini App. Returns the caller's admin
// status so the UI can conditionally surface the admin entry point (a button
// in the home header). NOT gated by requireAdmin — non-admins get
// `{ isAdmin: false }`. This only reveals the caller's own status, never the
// admin id; the real protection is on /api/admin/* (every call re-verified).
api.get("/me", (c) => {
  const ownerId = c.get("ownerId");
  return c.json({
    ownerId,
    isAdmin: isAdminOwnerId(ownerId, process.env.ADMIN_TELEGRAM_USER_ID),
  });
});

api.get("/owners/billing", async (c) => {
  const ownerId = c.get("ownerId");
  const summary = await getBillingSummary(ownerId);
  trackMini(ownerId, "billing.viewed");
  return c.json({ ...summary, botUsername: getOnboardingBotUsername() });
});

api.get("/documents", async (c) => {
  const botId = c.req.query("botId");
  if (!botId) return c.json({ error: "botId required" }, 400);
  const denied = await requireBotOwner(c, botId);
  if (denied) return denied;
  const docs = await listDocuments(botId);
  return c.json(docs);
});

api.post("/documents", async (c) => {
  const ownerId = c.get("ownerId");
  const body = await c.req.parseBody();
  const botId = typeof body.botId === "string" ? body.botId : "";
  const file = body.file;
  if (!botId) return c.json({ error: "botId required" }, 400);
  if (!(file instanceof File)) return c.json({ error: "file required" }, 400);

  const denied = await requireBotOwner(c, botId);
  if (denied) return denied;

  // Plan-cap quota gate (mirrors the bot upload path).
  const quota = await checkQuota(ownerId, "doc", { botId });
  if (!quota.ok) {
    return c.json({ error: "quota", reason: quota.reason }, 403);
  }

  const detectedMime = detectMimeType(file.name, file.type);
  if (!detectedMime) return c.json({ error: "unsupported file type" }, 400);

  const existing = await listDocuments(botId);
  const limitCheck = checkDocumentLimits({
    fileSize: file.size,
    currentDocCount: existing.length,
  });
  if (!limitCheck.ok) {
    return c.json({ error: limitCheck.reason, limit: limitCheck.limit }, 400);
  }

  const botRow = await db.query.tenantBots.findFirst({
    where: eq(tenantBots.id, botId),
    columns: { tenantId: true },
  });
  if (!botRow) return c.json({ error: "not found" }, 404);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { documentId } = await ingestDocument({
      buffer,
      fileName: file.name || "untitled",
      mimeType: detectedMime,
      tenantId: botRow.tenantId,
      botId,
    });
    // Keep owners.doc_count fresh so the billing screen + reminder-scan
    // see the new doc immediately instead of waiting for the weekly
    // reconcile. Mirrors the bot's batch-upload conversation in
    // apps/bot/src/bots/registry.ts.
    try {
      await incrementDocCount(ownerId);
    } catch (err) {
      logger.warn(
        { err, ownerId, botId },
        "miniapp: incrementDocCount failed (fail-open)",
      );
    }
    trackMini(ownerId, "doc.uploaded", botId);
    return c.json({ documentId }, 201);
  } catch (err) {
    logger.error({ err, botId }, "miniapp document upload failed");
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

// Cancel an in-flight ingest. Only valid while the doc is still
// "processing"; once it's "ready"/"failed" the client should use DELETE.
// Signals the worker to abort the Inngest run, then removes the row + B2
// file (chunks cascade) by reusing the delete path.
api.post("/documents/:id/cancel", async (c) => {
  const id = c.req.param("id");
  const ownerId = c.get("ownerId");
  const owner = await ownerForDocId(id);
  if (owner === null) return c.json({ error: "not found" }, 404);
  if (owner !== ownerId) return c.json({ error: "forbidden" }, 403);

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
    columns: { status: true },
  });
  if (!doc) return c.json({ error: "not found" }, 404);
  if (doc.status !== "processing") {
    return c.json({ error: "not processing" }, 409);
  }

  try {
    // Abort the worker run first so it stops before writing chunks, then
    // delete. The worker's pre-insert guard covers the residual race.
    await cancelDocumentIngest(id);
    await deleteDocument(id);
    try {
      await decrementDocCount(ownerId);
    } catch (err) {
      logger.warn(
        { err, ownerId, docId: id },
        "miniapp: decrementDocCount failed (fail-open)",
      );
    }
    trackMini(ownerId, "doc.canceled");
    return c.json({ success: true });
  } catch (err) {
    logger.error({ err, docId: id }, "miniapp document cancel failed");
    return c.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
    );
  }
});

api.delete("/documents/:id", async (c) => {
  const id = c.req.param("id");
  const ownerId = c.get("ownerId");
  const owner = await ownerForDocId(id);
  if (owner === null) return c.json({ error: "not found" }, 404);
  if (owner !== ownerId) return c.json({ error: "forbidden" }, 403);
  try {
    await deleteDocument(id);
    try {
      await decrementDocCount(ownerId);
    } catch (err) {
      logger.warn(
        { err, ownerId, docId: id },
        "miniapp: decrementDocCount failed (fail-open)",
      );
    }
    trackMini(ownerId, "doc.deleted");
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 404);
  }
});

// ---------------------------------------------------------------------------
// Admin dashboard (single operator). All three routes are gated by
// requireAdmin — the verified initData id must equal ADMIN_TELEGRAM_USER_ID.
// Non-admins (every owner) get a flat 403, same shape as requireBotOwner, so
// the Mini App can render a forbidden state without leaking the surface.
// ---------------------------------------------------------------------------

// Aggregate metrics + daily time-series for a date window. `from`/`to` are
// optional ISO/date strings; parseDateRange defaults to the last 30 days and
// tolerates missing/invalid/inverted bounds. Cached ~60s per range upstream.
api.get("/admin/metrics", async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const range = parseDateRange(c.req.query("from"), c.req.query("to"));
  try {
    const metrics = await getAdminMetrics(range);
    trackMini(c.get("ownerId"), "admin.metrics.viewed");
    return c.json(metrics);
  } catch (err) {
    logger.error({ err }, "admin metrics failed");
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

// Paginated owner directory for the drill-down table. `search` matches a
// numeric id exactly or a username (with/without @) case-insensitively.
api.get("/admin/owners", async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const pageRaw = Number.parseInt(c.req.query("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) ? pageRaw : 1;
  try {
    const result = await listAdminOwners({ search: c.req.query("search"), page });
    return c.json(result);
  } catch (err) {
    logger.error({ err }, "admin owners list failed");
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

// One owner's full detail (profile + subscriptions + bots). 404 when no such
// owner. The id is path-supplied but only an admin reaches this handler.
api.get("/admin/owners/:id", async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  try {
    const detail = await getAdminOwnerDetail(c.req.param("id"));
    if (!detail) return c.json({ error: "not found" }, 404);
    return c.json(detail);
  } catch (err) {
    logger.error({ err }, "admin owner detail failed");
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

// Ban / unban an owner from the dashboard. Reuses the exact same core as the
// `/ban` + `/unban` admin commands (`lib/owner-moderation.ts`): ban flags the
// row, updates the in-memory ban cache, and fires `owner/banned` (cancels
// subs + pauses bots); unban clears the flag + cache. Owner ids are numeric
// Telegram user ids — reject anything else before touching the DB.
api.post("/admin/owners/:id/ban", async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const id = c.req.param("id");
  if (!/^\d+$/.test(id)) return c.json({ error: "invalid id" }, 400);
  try {
    const { found } = await banOwner(id);
    if (!found) return c.json({ error: "not found" }, 404);
    trackMini(c.get("ownerId"), "admin.owner.banned");
    return c.json({ success: true });
  } catch (err) {
    logger.error({ err, id }, "admin ban failed");
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

api.post("/admin/owners/:id/unban", async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const id = c.req.param("id");
  if (!/^\d+$/.test(id)) return c.json({ error: "invalid id" }, 400);
  try {
    const { found } = await unbanOwner(id);
    if (!found) return c.json({ error: "not found" }, 404);
    trackMini(c.get("ownerId"), "admin.owner.unbanned");
    return c.json({ success: true });
  } catch (err) {
    logger.error({ err, id }, "admin unban failed");
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
