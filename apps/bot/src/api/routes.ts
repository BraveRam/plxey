import { Hono } from "hono";
import { z } from "zod";
import { zodValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
import { db, documents, tenants, tenantBots } from "@tg-business/db";
import {
  getOrCreateTenant,
  listBots,
  createBot,
  updateBot,
  deleteBot,
  listDocuments,
  deleteDocument,
} from "../lib/api";
import { isBotOwnerBanned, isOwnerBanned } from "../lib/banned";
import { apiLimiter } from "../lib/redis";
import { clientIp } from "../lib/client-ip";
import { authMiddleware, type TelegramUser } from "../lib/auth";

export const api = new Hono<{
  Variables: {
    user: TelegramUser;
  };
}>();

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

async function checkBotOwnership(botId: string, ownerId: string): Promise<boolean> {
  const bot = await db.query.tenantBots.findFirst({
    where: eq(tenantBots.id, botId),
    columns: { tenantId: true },
  });
  if (!bot) return false;
  const tenant = await db.query.tenants.findFirst({
    where: and(eq(tenants.id, bot.tenantId), eq(tenants.telegramOwnerId, ownerId)),
    columns: { id: true },
  });
  return !!tenant;
}

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

api.use("*", authMiddleware);

api.post("/tenants", async (c) => {
  const user = c.get("user");
  const telegramOwnerId = String(user.id);

  if (await isOwnerBanned(telegramOwnerId)) {
    return c.json({ error: "banned" }, 403);
  }
  try {
    const tenant = await getOrCreateTenant(telegramOwnerId);
    return c.json(tenant);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

api.get("/bots", async (c) => {
  const user = c.get("user");
  const userId = String(user.id);
  const bots = await listBots(userId);
  return c.json(bots);
});

const createBotSchema = z.object({
  token: z.string().min(1),
});

api.post("/bots", zodValidator("json", createBotSchema), async (c) => {
  const user = c.get("user");
  const telegramOwnerId = String(user.id);
  const { token } = c.req.valid("json");

  if (await isOwnerBanned(telegramOwnerId)) {
    return c.json({ error: "banned" }, 403);
  }
  try {
    const botRecord = await createBot(token, telegramOwnerId);
    return c.json(botRecord, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 400);
  }
});

const updateBotSchema = z.object({
  status: z.enum(["active", "paused"]).optional(),
  systemPrompt: z.string().optional(),
  welcomeMessage: z.string().nullable().optional(),
  autoReadBusinessMessages: z.boolean().optional(),
});

api.patch("/bots/:id", zodValidator("json", updateBotSchema), async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const userId = String(user.id);

  if (!(await checkBotOwnership(id, userId))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (await isBotOwnerBanned(id)) {
    return c.json({ error: "banned" }, 403);
  }
  const data = c.req.valid("json");
  try {
    const updated = await updateBot(id, data);
    return c.json(updated);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 404);
  }
});

api.delete("/bots/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const userId = String(user.id);

  if (!(await checkBotOwnership(id, userId))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (await isBotOwnerBanned(id)) {
    return c.json({ error: "banned" }, 403);
  }
  try {
    await deleteBot(id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 404);
  }
});

const listDocumentsSchema = z.object({
  botId: z.string().min(1),
});

api.get("/documents", zodValidator("query", listDocumentsSchema), async (c) => {
  const { botId } = c.req.valid("query");

  const user = c.get("user");
  const userId = String(user.id);

  if (!(await checkBotOwnership(botId, userId))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const docs = await listDocuments(botId);
  return c.json(docs);
});

api.delete("/documents/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const userId = String(user.id);

  const ownerId = await ownerForDocId(id);
  if (ownerId !== userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (ownerId !== null && (await isOwnerBanned(ownerId))) {
    return c.json({ error: "banned" }, 403);
  }
  try {
    await deleteDocument(id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 404);
  }
});
