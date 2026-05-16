import { Hono } from "hono";
import { getOrCreateTenant, listBots, createBot, updateBot, deleteBot, listDocuments, deleteDocument } from "../lib/api";

export const api = new Hono();

api.post("/tenants", async (c) => {
  const { telegramOwnerId } = await c.req.json<{ telegramOwnerId: string }>();
  if (!telegramOwnerId) return c.json({ error: "telegramOwnerId required" }, 400);
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
  try {
    const botRecord = await createBot(token, telegramOwnerId);
    return c.json(botRecord, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 400);
  }
});

api.patch("/bots/:id", async (c) => {
  const id = c.req.param("id");
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
  try {
    await deleteDocument(id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 404);
  }
});
