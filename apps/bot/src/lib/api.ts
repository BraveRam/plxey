import { eq, inArray } from "drizzle-orm";
import { Bot } from "grammy";
import {
  db,
  documents,
  tenants,
  tenantBots,
  DEFAULT_SYSTEM_PROMPT,
} from "@tg-business/db";
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
  autoReadBusinessMessages: boolean;
  dailyUserAiReplyLimit: number | null;
  dailyCapReachedMessage: string | null;
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

/**
 * Client-safe view of a bot. Omits `botTokenEncrypted` and
 * `webhookSecret` — these must never reach the Mini App or any other
 * external caller.
 */
export interface PublicBotResult {
  id: string;
  tenantId: string;
  botUsername: string | null;
  status: string;
  systemPrompt: string;
  welcomeMessage: string | null;
  autoReadBusinessMessages: boolean;
  dailyUserAiReplyLimit: number | null;
  dailyCapReachedMessage: string | null;
  createdAt: Date;
}

export function toPublicBot(bot: BotResult): PublicBotResult {
  return {
    id: bot.id,
    tenantId: bot.tenantId,
    botUsername: bot.botUsername,
    status: bot.status,
    systemPrompt: bot.systemPrompt,
    welcomeMessage: bot.welcomeMessage,
    autoReadBusinessMessages: bot.autoReadBusinessMessages,
    dailyUserAiReplyLimit: bot.dailyUserAiReplyLimit,
    dailyCapReachedMessage: bot.dailyCapReachedMessage,
    createdAt: bot.createdAt,
  };
}

/**
 * Resolve the Telegram owner id that owns a given tenant bot, or null if
 * the bot doesn't exist. Used by routes to enforce that the verified
 * caller owns the resource before mutating it.
 */
export async function ownerForBotId(botId: string): Promise<string | null> {
  const bot = await db.query.tenantBots.findFirst({
    where: eq(tenantBots.id, botId),
    columns: { tenantId: true },
  });
  if (!bot) return null;
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, bot.tenantId),
    columns: { telegramOwnerId: true },
  });
  return tenant?.telegramOwnerId ?? null;
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
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  }).returning();

  logger.info({ botId: botRecord!.id, botUsername: botRecord!.botUsername }, "bot registered");
  return botRecord!;
}

export async function updateBot(id: string, data: { status?: string; systemPrompt?: string; welcomeMessage?: string | null; autoReadBusinessMessages?: boolean; dailyUserAiReplyLimit?: number | null; dailyCapReachedMessage?: string | null }): Promise<BotResult> {
  const botRecord = await db.query.tenantBots.findFirst({
    where: eq(tenantBots.id, id),
  });
  if (!botRecord) throw new Error("Bot not found");

  const updates: Record<string, unknown> = {};
  if (data.systemPrompt !== undefined) updates.systemPrompt = data.systemPrompt;
  if (data.welcomeMessage !== undefined) updates.welcomeMessage = data.welcomeMessage;
  if (data.autoReadBusinessMessages !== undefined) updates.autoReadBusinessMessages = data.autoReadBusinessMessages;
  if (data.dailyUserAiReplyLimit !== undefined) updates.dailyUserAiReplyLimit = data.dailyUserAiReplyLimit;
  if (data.dailyCapReachedMessage !== undefined) updates.dailyCapReachedMessage = data.dailyCapReachedMessage;
  if (data.status !== undefined) updates.status = data.status;

  if (Object.keys(updates).length > 0) {
    await db.update(tenantBots).set(updates).where(eq(tenantBots.id, id));
  }

  logger.info({ botId: id, updates }, "bot updated");
  const updated = await db.query.tenantBots.findFirst({ where: eq(tenantBots.id, id) });
  return updated!;
}

/**
 * Outcome of `restartBot`. `ok:true` carries the (possibly refreshed)
 * username from getMe; `ok:false` carries a machine-readable reason the
 * caller maps to an owner-facing message (`restartErrorMessage`).
 */
export type RestartBotResult =
  | { ok: true; botUsername: string | null }
  | { ok: false; reason: "not_configured" | "token_invalid" | "webhook_failed" };

/**
 * Re-validate a bot's token and re-establish its webhook, then reactivate it.
 *
 * Powers the onboarding bot's "Restart" button: recovers a bot that went
 * silent (webhook cleared by Telegram, token reused elsewhere) without a
 * delete + re-add that would drop its config, documents, and conversations.
 *
 *   1. Decrypt the stored token and call `getMe` — proves the token still
 *      works. A token revoked in BotFather fails here → `token_invalid`.
 *   2. `setWebhook` back to this bot's tenant endpoint (same params as
 *      onboarding creation: drop_pending_updates + secret_token).
 *   3. Flip status back to `active` and refresh the cached username.
 *
 * Returns a result union instead of throwing for the expected operational
 * failures so the caller can surface an actionable message. Throws only for
 * a missing bot row (stale button / programming error).
 */
export async function restartBot(id: string): Promise<RestartBotResult> {
  const botRecord = await db.query.tenantBots.findFirst({
    where: eq(tenantBots.id, id),
  });
  if (!botRecord) throw new Error("Bot not found");

  const publicUrl = process.env.PUBLIC_URL;
  if (!publicUrl) {
    logger.error({ botId: id }, "restartBot: PUBLIC_URL not configured");
    return { ok: false, reason: "not_configured" };
  }

  const decryptedToken = await decrypt(botRecord.botTokenEncrypted);
  const temp = new Bot(decryptedToken);

  // 1. Validate the token. getMe 401s if it was revoked in BotFather.
  let botUsername: string | null;
  try {
    const me = await temp.api.getMe();
    botUsername = me.username ?? null;
  } catch (err) {
    logger.warn({ err, botId: id }, "restartBot: getMe failed — token likely revoked");
    return { ok: false, reason: "token_invalid" };
  }

  // 2. Re-establish the webhook (mirrors onboarding bot creation).
  try {
    await temp.api.setWebhook(`${publicUrl}/webhook/tenant/${id}`, {
      drop_pending_updates: true,
      secret_token: botRecord.webhookSecret,
    });
  } catch (err) {
    logger.error({ err, botId: id }, "restartBot: setWebhook failed");
    return { ok: false, reason: "webhook_failed" };
  }

  // 3. Reactivate and refresh the cached username (it may have changed).
  await db
    .update(tenantBots)
    .set({ status: "active", ...(botUsername ? { botUsername } : {}) })
    .where(eq(tenantBots.id, id));

  logger.info({ botId: id, botUsername }, "bot restarted");
  return { ok: true, botUsername };
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
