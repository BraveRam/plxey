import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, documents, tenants } from "@tg-business/db";
import { getOrCreateTenant, listBots, createBot, updateBot, deleteBot, listDocuments, deleteDocument } from "../lib/api";
import { isBotOwnerBanned, isOwnerBanned } from "../lib/banned";
import { apiLimiter } from "../lib/redis";
import { clientIp } from "../lib/client-ip";

export const api = new Hono();

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

api.post("/tenants", async (c) => {
  const { telegramOwnerId } = await c.req.json<{ telegramOwnerId: string }>();
  if (!telegramOwnerId) return c.json({ error: "telegramOwnerId required" }, 400);
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
  const userId = c.req.query("userId");
  if (!userId) return c.json({ error: "userId required" }, 400);
  const bots = await listBots(userId);
  return c.json(bots);
});

api.post("/bots", async (c) => {
  const { token, telegramOwnerId } = await c.req.json<{ token: string; telegramOwnerId: string }>();
  if (!token || !telegramOwnerId) return c.json({ error: "token and telegramOwnerId required" }, 400);
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

api.patch("/bots/:id", async (c) => {
  const id = c.req.param("id");
  if (await isBotOwnerBanned(id)) {
    return c.json({ error: "banned" }, 403);
  }
  const { status, systemPrompt, welcomeMessage, autoReadBusinessMessages } = await c.req.json<{ status?: string; systemPrompt?: string; welcomeMessage?: string | null; autoReadBusinessMessages?: boolean }>();
  try {
    const updated = await updateBot(id, { status, systemPrompt, welcomeMessage, autoReadBusinessMessages });
    return c.json(updated);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 404);
  }
});

api.delete("/bots/:id", async (c) => {
  const id = c.req.param("id");
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

api.get("/documents", async (c) => {
  const botId = c.req.query("botId");
  if (!botId) return c.json({ error: "botId required" }, 400);
  const docs = await listDocuments(botId);
  return c.json(docs);
});

api.delete("/documents/:id", async (c) => {
  const id = c.req.param("id");
  const ownerId = await ownerForDocId(id);
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
