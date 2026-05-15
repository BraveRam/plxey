import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { Bot } from "grammy";
import { db } from "../db";
import { tenants, tenantBots } from "../db/schema";
import { encrypt, decrypt } from "../lib/crypto";
import { registry } from "../bots/registry";
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

// POST /bots — register a new bot
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

  const webhookBase = process.env.PUBLIC_URL;
  if (!webhookBase) return c.json({ error: "PUBLIC_URL not configured" }, 500);

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

  await registry.register(token, botRecord!.id);

  const webhookUrl = `${webhookBase}/webhook/tenant/${botRecord!.id}`;
  await tempBot.api.setWebhook(webhookUrl, { drop_pending_updates: true });

  logger.info({ botId: botRecord!.id, botUsername: botRecord!.botUsername }, "bot registered");
  return c.json(botRecord!, 201);
});

// PATCH /bots/:id — update bot (pause, resume, prompt)
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

  if (status === "paused") {
    logger.info({ botId: id }, "bot paused");
    registry.remove(id);
  } else if (status === "active") {
    const loaded = await registry.load(id);
    if (loaded) {
      const webhookBase = process.env.PUBLIC_URL;
      if (webhookBase) {
        await loaded.api.setWebhook(`${webhookBase}/webhook/tenant/${id}`, { drop_pending_updates: true });
      }
    }
  }

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

  registry.remove(id);

  try {
    const decryptedToken = await decrypt(botRecord.botTokenEncrypted);
    const temp = new Bot(decryptedToken);
    await temp.api.setWebhook("");
  } catch {}

  logger.info({ botId: id }, "bot deleted");
  await db.delete(tenantBots).where(eq(tenantBots.id, id));

  return c.json({ success: true });
});
