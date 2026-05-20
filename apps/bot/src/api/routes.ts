import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { db, documents, tenants } from "@tg-business/db";
import { getOrCreateTenant, listBots, createBot, updateBot, deleteBot, listDocuments, deleteDocument } from "../lib/api";
import { isBotOwnerBanned, isOwnerBanned, ownerIdForBot } from "../lib/banned";
import { apiLimiter } from "../lib/redis";
import { clientIp } from "../lib/client-ip";
import { authMiddleware } from "../lib/auth";

export const api = new Hono<{ Variables: { user: { id: number } } }>();

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

api.use("*", authMiddleware);

const tenantsSchema = z.object({
  telegramOwnerId: z.string().min(1),
});

api.post("/tenants", zValidator("json", tenantsSchema), async (c) => {
  const { telegramOwnerId } = c.req.valid("json");

  const authUser = c.get("user");
  if (telegramOwnerId !== String(authUser.id)) {
    return c.json({ error: "Forbidden: User ID mismatch" }, 403);
  }

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

const listBotsSchema = z.object({
  userId: z.string().min(1),
});

api.get("/bots", zValidator("query", listBotsSchema), async (c) => {
  const { userId } = c.req.valid("query");

  const authUser = c.get("user");
  if (userId !== String(authUser.id)) {
    return c.json({ error: "Forbidden: User ID mismatch" }, 403);
  }

  const bots = await listBots(userId);
  return c.json(bots);
});

const botsSchema = z.object({
  token: z.string().min(1),
  telegramOwnerId: z.string().min(1),
});

api.post("/bots", zValidator("json", botsSchema), async (c) => {
  const { token, telegramOwnerId } = c.req.valid("json");

  const authUser = c.get("user");
  if (telegramOwnerId !== String(authUser.id)) {
    return c.json({ error: "Forbidden: User ID mismatch" }, 403);
  }

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
  status: z.enum(["active", "paused", "revoked"]).optional(),
  systemPrompt: z.string().min(1).optional(),
  welcomeMessage: z.string().nullable().optional(),
  autoReadBusinessMessages: z.boolean().optional(),
});

api.patch("/bots/:id", zValidator("param", z.object({ id: z.string().uuid() })), zValidator("json", updateBotSchema), async (c) => {
  const { id } = c.req.valid("param");

  const authUser = c.get("user");
  const ownerId = await ownerIdForBot(id);
  if (ownerId !== String(authUser.id)) {
    return c.json({ error: "Forbidden: User ID mismatch" }, 403);
  }

  if (await isBotOwnerBanned(id)) {
    return c.json({ error: "banned" }, 403);
  }
  const { status, systemPrompt, welcomeMessage, autoReadBusinessMessages } = c.req.valid("json");
  try {
    const updated = await updateBot(id, { status, systemPrompt, welcomeMessage, autoReadBusinessMessages });
    return c.json(updated);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 404);
  }
});

api.delete("/bots/:id", zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
  const { id } = c.req.valid("param");

  const authUser = c.get("user");
  const ownerId = await ownerIdForBot(id);
  if (ownerId !== String(authUser.id)) {
    return c.json({ error: "Forbidden: User ID mismatch" }, 403);
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

const listDocsSchema = z.object({
  botId: z.string().uuid(),
});

api.get("/documents", zValidator("query", listDocsSchema), async (c) => {
  const { botId } = c.req.valid("query");

  const authUser = c.get("user");
  const ownerId = await ownerIdForBot(botId);
  if (ownerId !== String(authUser.id)) {
    return c.json({ error: "Forbidden: User ID mismatch" }, 403);
  }

  const docs = await listDocuments(botId);
  return c.json(docs);
});

api.delete("/documents/:id", zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
  const { id } = c.req.valid("param");
  const ownerId = await ownerForDocId(id);

  const authUser = c.get("user");
  if (ownerId !== String(authUser.id)) {
    return c.json({ error: "Forbidden: User ID mismatch" }, 403);
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
