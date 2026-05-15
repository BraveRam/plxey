import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { Bot } from "grammy";
import { db, documents, tenants, tenantBots } from "@tg-business/db";
import { encrypt, decrypt } from "@tg-business/crypto";
import { deleteFile, b2BucketId } from "@tg-business/storage";
import { logger } from "../lib/logger";
import { randomBytes } from "crypto";

export const api = new Hono();

// POST /tenants — get or create tenant by telegram user id
api.post("/tenants", async (c) => {
  const { telegramOwnerId } = await c.req.json<{ telegramOwnerId: string }>();
  if (!telegramOwnerId) return c.json({ error: "telegramOwnerId required" }, 400);

  let tenant = await db.query.tenants.findFirst({
    where: eq(tenants.telegramOwnerId, telegramOwnerId),
  });

  if (!tenant) {
    [tenant] = await db.insert(tenants).values({
      name: `user-${telegramOwnerId}`,
      slug: randomBytes(4).toString("hex"),
      telegramOwnerId,
    }).returning();
  }

  return c.json(tenant);
});

// GET /bots — list bots for a user
api.get("/bots", async (c) => {
  const userId = c.req.query("userId");
  if (!userId) return c.json({ error: "userId required" }, 400);

  const userTenants = await db.query.tenants.findMany({
    where: eq(tenants.telegramOwnerId, userId),
  });

  if (userTenants.length === 0) return c.json([]);

  const tenantIds = userTenants.map(t => t.id);
  const bots = await db.query.tenantBots.findMany({
    where: (tb, { inArray }) => inArray(tb.tenantId, tenantIds),
  });

  return c.json(bots);
});

// POST /bots — register a new bot (validate, encrypt, store)
api.post("/bots", async (c) => {
  const { token, telegramOwnerId } = await c.req.json<{ token: string; telegramOwnerId: string }>();
  if (!token || !telegramOwnerId) return c.json({ error: "token and telegramOwnerId required" }, 400);

  const tempBot = new Bot(token);
  let botUser;
  try {
    botUser = await tempBot.api.getMe();
  } catch {
    return c.json({ error: "Invalid bot token" }, 400);
  }

  const existing = await db.query.tenantBots.findFirst({
    where: eq(tenantBots.botUsername, botUser.username),
  });
  if (existing) {
    return c.json({ error: "This bot is already registered by another user." }, 409);
  }

  let tenant = await db.query.tenants.findFirst({
    where: eq(tenants.telegramOwnerId, telegramOwnerId),
  });

  if (!tenant) {
    [tenant] = await db.insert(tenants).values({
      name: botUser.first_name,
      slug: randomBytes(4).toString("hex"),
      telegramOwnerId,
    }).returning();
  }

  const webhookSecret = randomBytes(16).toString("hex");
  const encryptedToken = await encrypt(token);

  const [botRecord] = await db.insert(tenantBots).values({
    tenantId: tenant!.id,
    botTokenEncrypted: encryptedToken,
    botUsername: botUser.username,
    webhookSecret,
  }).returning();

  logger.info({ botId: botRecord!.id, botUsername: botRecord!.botUsername }, "bot registered");
  return c.json(botRecord!, 201);
});

// PATCH /bots/:id — update bot (status, prompt)
api.patch("/bots/:id", async (c) => {
  const id = c.req.param("id");
  const { status, systemPrompt } = await c.req.json<{ status?: string; systemPrompt?: string }>();

  const botRecord = await db.query.tenantBots.findFirst({
    where: eq(tenantBots.id, id),
  });
  if (!botRecord) return c.json({ error: "Bot not found" }, 404);

  const updates: Record<string, unknown> = {};
  if (systemPrompt !== undefined) updates.systemPrompt = systemPrompt;
  if (status !== undefined) updates.status = status;

  if (Object.keys(updates).length > 0) {
    await db.update(tenantBots).set(updates).where(eq(tenantBots.id, id));
  }

  logger.info({ botId: id, updates }, "bot updated");
  const updated = await db.query.tenantBots.findFirst({ where: eq(tenantBots.id, id) });
  return c.json(updated);
});

// DELETE /bots/:id — delete bot
api.delete("/bots/:id", async (c) => {
  const id = c.req.param("id");

  const botRecord = await db.query.tenantBots.findFirst({
    where: eq(tenantBots.id, id),
  });
  if (!botRecord) return c.json({ error: "Bot not found" }, 404);

  try {
    const decryptedToken = await decrypt(botRecord.botTokenEncrypted);
    const temp = new Bot(decryptedToken);
    await temp.api.setWebhook("");
  } catch {}

  logger.info({ botId: id }, "bot deleted");
  await db.delete(tenantBots).where(eq(tenantBots.id, id));

  return c.json({ success: true });
});

// GET /documents — list documents for a tenant
api.get("/documents", async (c) => {
  const tenantId = c.req.query("tenantId");
  if (!tenantId) return c.json({ error: "tenantId required" }, 400);

  const docs = await db.query.documents.findMany({
    where: eq(documents.tenantId, tenantId),
    orderBy: (d, { desc }) => [desc(d.createdAt)],
  });

  return c.json(docs);
});

// DELETE /documents/:id — delete document (DB + B2)
api.delete("/documents/:id", async (c) => {
  const id = c.req.param("id");

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
  });
  if (!doc) return c.json({ error: "Document not found" }, 404);

  if (doc.b2FileId && doc.b2FileName) {
    try {
      await deleteFile(b2BucketId(), doc.b2FileId, doc.b2FileName);
    } catch (err) {
      logger.warn({ err, docId: id }, "failed to delete B2 file");
    }
  }

  await db.delete(documents).where(eq(documents.id, id));

  logger.info({ docId: id }, "document deleted");
  return c.json({ success: true });
});
