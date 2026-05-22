import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
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
  toPublicBot,
  ownerForBotId,
} from "../lib/api";
import { isOwnerBanned } from "../lib/banned";
import { apiLimiter } from "../lib/redis";
import { clientIp } from "../lib/client-ip";
import { verifyInitData } from "../lib/telegram-auth";
import { checkQuota } from "../lib/owners";
import { detectMimeType } from "../bots/document-types";
import { checkDocumentLimits } from "../bots/document-limits";
import { ingestDocument } from "../lib/doc-ingest";
import { getBotStats } from "../lib/analytics-stats";
import { getBillingSummary } from "../lib/billing-read";
import { logger } from "../lib/logger";

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
  const bots = await listBots(c.get("ownerId"));
  return c.json(bots.map(toPublicBot));
});

api.post("/bots", async (c) => {
  const { token } = await c.req.json<{ token: string }>();
  if (!token) return c.json({ error: "token required" }, 400);
  try {
    const botRecord = await createBot(token, c.get("ownerId"));
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
    return c.json(toPublicBot(updated));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 404);
  }
});

api.delete("/bots/:id", async (c) => {
  const id = c.req.param("id");
  const denied = await requireBotOwner(c, id);
  if (denied) return denied;
  try {
    await deleteBot(id);
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

api.get("/owners/billing", async (c) => {
  const summary = await getBillingSummary(c.get("ownerId"));
  return c.json(summary);
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
    return c.json({ documentId }, 201);
  } catch (err) {
    logger.error({ err, botId }, "miniapp document upload failed");
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

api.delete("/documents/:id", async (c) => {
  const id = c.req.param("id");
  const owner = await ownerForDocId(id);
  if (owner === null) return c.json({ error: "not found" }, 404);
  if (owner !== c.get("ownerId")) return c.json({ error: "forbidden" }, 403);
  try {
    await deleteDocument(id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 404);
  }
});
