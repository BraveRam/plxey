import { eq, inArray } from "drizzle-orm";
import { Bot } from "grammy";
import { db, documents, tenants, tenantBots } from "@tg-business/db";
import { encrypt, decrypt } from "@tg-business/crypto";
import { deleteFile, b2BucketId } from "@tg-business/storage";
import { logger } from "./logger";
import { randomBytes } from "crypto";

export interface TenantResult {
  id: string;
  name: string;
  slug: string;
  telegramOwnerId: string;
  createdAt: Date;
}

export interface BotResult {
  id: string;
  tenantId: string;
  botTokenEncrypted: string;
  botUsername: string | null;
  status: string;
  webhookSecret: string;
  systemPrompt: string;
  welcomeMessage: string | null;
  createdAt: Date;
}

export interface DocumentResult {
  id: string;
  tenantId: string;
  fileName: string;
  mimeType: string;
  status: string;
  source: string;
  createdAt: Date;
}

export async function getOrCreateTenant(telegramOwnerId: string): Promise<TenantResult> {
  if (!telegramOwnerId) throw new Error("telegramOwnerId required");

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

  return tenant!;
}

export async function listBots(userId: string): Promise<BotResult[]> {
  const userTenants = await db.query.tenants.findMany({
    where: eq(tenants.telegramOwnerId, userId),
  });

  if (userTenants.length === 0) return [];

  const tenantIds = userTenants.map(t => t.id);
  return db.query.tenantBots.findMany({
    where: (tb, { inArray }) => inArray(tb.tenantId, tenantIds),
  });
}

export async function createBot(token: string, telegramOwnerId: string): Promise<BotResult> {
  if (!token || !telegramOwnerId) throw new Error("token and telegramOwnerId required");

  const tempBot = new Bot(token);
  let botUser;
  try {
    botUser = await tempBot.api.getMe();
  } catch {
    throw new Error("Invalid bot token");
  }

  const existing = await db.query.tenantBots.findFirst({
    where: eq(tenantBots.botUsername, botUser.username),
  });
  if (existing) {
    throw new Error("This bot is already registered by another user.");
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
  return botRecord!;
}

export async function updateBot(id: string, data: { status?: string; systemPrompt?: string; welcomeMessage?: string | null }): Promise<BotResult> {
  const botRecord = await db.query.tenantBots.findFirst({
    where: eq(tenantBots.id, id),
  });
  if (!botRecord) throw new Error("Bot not found");

  const updates: Record<string, unknown> = {};
  if (data.systemPrompt !== undefined) updates.systemPrompt = data.systemPrompt;
  if (data.welcomeMessage !== undefined) updates.welcomeMessage = data.welcomeMessage;
  if (data.status !== undefined) updates.status = data.status;

  if (Object.keys(updates).length > 0) {
    await db.update(tenantBots).set(updates).where(eq(tenantBots.id, id));
  }

  logger.info({ botId: id, updates }, "bot updated");
  const updated = await db.query.tenantBots.findFirst({ where: eq(tenantBots.id, id) });
  return updated!;
}

export async function deleteBot(id: string): Promise<void> {
  const botRecord = await db.query.tenantBots.findFirst({
    where: eq(tenantBots.id, id),
  });
  if (!botRecord) throw new Error("Bot not found");

  try {
    const decryptedToken = await decrypt(botRecord.botTokenEncrypted);
    const temp = new Bot(decryptedToken);
    await temp.api.setWebhook("");
  } catch {}

  logger.info({ botId: id }, "bot deleted");
  await db.delete(tenantBots).where(eq(tenantBots.id, id));
}

export async function listDocuments(botId: string): Promise<DocumentResult[]> {
  if (!botId) throw new Error("botId required");

  return db.query.documents.findMany({
    where: eq(documents.tenantBotId, botId),
    orderBy: (d, { desc }) => [desc(d.createdAt)],
  });
}

export async function deleteDocument(id: string): Promise<void> {
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
  });
  if (!doc) throw new Error("Document not found");

  if (doc.b2FileId && doc.b2FileName) {
    try {
      await deleteFile(b2BucketId(), doc.b2FileId, doc.b2FileName);
    } catch (err) {
      logger.warn({ err, docId: id }, "failed to delete B2 file");
    }
  }

  await db.delete(documents).where(eq(documents.id, id));
  logger.info({ docId: id }, "document deleted");
}
