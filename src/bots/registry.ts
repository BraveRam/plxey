import { Bot, type Context, InlineKeyboard } from "grammy";
import { eq, and, asc } from "drizzle-orm";
import { db } from "../db";
import { tenants, tenantBots, conversations, messages } from "../db/schema";
import { decrypt } from "../lib/crypto";
import { askAI } from "../services/ai";
import { logger } from "../lib/logger";
import {
  createReplyCallbackData,
  DbAdminReplyTargets,
  type AdminReplyTargets,
} from "./admin-reply-targets";

interface BotEntry {
  bot: Bot<Context>;
  token: string;
  tenantId: string;
  ownerTelegramId: string;
  systemPrompt: string;
  botUsername: string;
}

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

export class BotRegistry {
  private bots = new Map<string, BotEntry>();

  constructor(private ownerReplyTargets: AdminReplyTargets = new DbAdminReplyTargets()) {}

  async get(botId: string): Promise<Bot<Context> | null> {
    const existing = this.bots.get(botId);
    if (existing) return existing.bot;

    const row = await db.query.tenantBots.findFirst({
      where: eq(tenantBots.id, botId),
    });
    if (!row || row.status !== "active") return null;

    const token = await decrypt(row.botTokenEncrypted);
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, row.tenantId),
    });
    if (!tenant) return null;

    const bot = await this.createBot(row, token, tenant);
    logger.info({ botId, botUsername: row.botUsername }, "bot loaded from DB");
    return bot;
  }

  async register(rawToken: string, botId: string): Promise<Bot> {
    const row = await db.query.tenantBots.findFirst({ where: eq(tenantBots.id, botId) });
    if (!row) throw new Error("Bot not found in DB after insert");

    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, row.tenantId) });
    if (!tenant) throw new Error("Tenant not found");

    const bot = new Bot(rawToken);
    await bot.init();
    this.attachHandlers(bot, botId, tenant.telegramOwnerId, row.systemPrompt, row.botUsername ?? "");
    this.bots.set(botId, {
      bot, token: rawToken, tenantId: row.tenantId,
      ownerTelegramId: tenant.telegramOwnerId, systemPrompt: row.systemPrompt,
      botUsername: row.botUsername ?? "",
    });
    return bot;
  }

  private async createBot(row: typeof tenantBots.$inferSelect, token: string, tenant: typeof tenants.$inferSelect): Promise<Bot<Context>> {
    const bot = new Bot(token);
    await bot.init();
    this.attachHandlers(bot, row.id, tenant.telegramOwnerId, row.systemPrompt, row.botUsername ?? "");
    this.bots.set(row.id, {
      bot, token, tenantId: row.tenantId,
      ownerTelegramId: tenant.telegramOwnerId, systemPrompt: row.systemPrompt,
      botUsername: row.botUsername ?? "",
    });
    return bot;
  }

  private attachHandlers(bot: Bot<Context>, botId: string, ownerTelegramId: string, systemPrompt: string, businessName: string): void {
    bot.on("business_message", async (ctx) => {
      const msg = ctx.update.business_message;
      if (typeof msg?.text !== "string") return;

      const question: string = msg.text;
      const connId = msg.business_connection_id;
      if (!connId) return;
      const chatId = msg.chat.id;

      const botEntry = this.bots.get(botId);
      if (!botEntry) {
        logger.error({ botId }, "no bot entry loaded");
        return;
      }
      const tenantId = botEntry.tenantId;
      const conv = await this.getOrCreateConversation(tenantId, connId, chatId);
      const dbHistory = await this.loadHistory(conv.id);

      await db.insert(messages).values({
        conversationId: conv.id, tenantId,
        role: "user", content: question, telegramMessageId: String(msg.message_id),
      });

      await this.sendTypingAction(ctx, chatId, connId, botId);

      const result: Awaited<ReturnType<typeof askAI>> = await askAI(
        question,
        businessName,
        systemPrompt,
        dbHistory,
        {
          sendAdminMessage: async ({ message }) => {
            try {
              const replyToken = await this.ownerReplyTargets.create({ botId, chatId, businessConnectionId: connId });
              const kb = new InlineKeyboard().text("✏️ Reply", createReplyCallbackData(replyToken));
              await ctx.api.sendMessage(
                Number(ownerTelegramId),
                `💬 ${message}`,
                { reply_markup: kb },
              );
              return { ok: true };
            } catch (err) {
              logger.error({ err, botId }, "failed to send admin message");
              return { ok: false, error: "admin_message_send_failed" };
            }
          },
        },
      ).catch((err): Awaited<ReturnType<typeof askAI>> => {
        logger.error({ err, botId }, "AI error");
        return { text: null };
      });

      // Model answered
      if (result.text !== null) {
        await db.insert(messages).values({
          conversationId: conv.id, tenantId,
          role: "assistant", content: result.text,
        });
        await db.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conv.id));

        try {
          await ctx.api.sendMessage(chatId, result.text, { business_connection_id: connId });
        } catch (e) {
          logger.warn({ err: e, botId, connId }, "BUSINESS_PEER_INVALID sending answer");
          await ctx.api.sendMessage(
            Number(ownerTelegramId),
            `⚠️ Failed to reply to customer. Make sure the bot has Business Mode enabled in @BotFather and is added as admin to your Telegram Business account.\n\nCustomer asked: ${question}`,
          );
        }
        return;
      }
    });

    bot.callbackQuery(/^oreply_(.+)$/, async (ctx) => {
      const token = ctx.match[1];
      const ownerId = ctx.from?.id ? String(ctx.from.id) : null;
      if (!token || !ownerId || !(await this.ownerReplyTargets.activate(ownerId, token))) {
        await ctx.answerCallbackQuery({ text: "This reply target is no longer available.", show_alert: true });
        return;
      }

      await ctx.answerCallbackQuery();
      await ctx.editMessageText("Send your reply to forward to the customer.");
    });

    bot.on("message", async (ctx) => {
      if (!ctx.from) return;
      const ownerId = String(ctx.from.id);

      if (!this.findByOwner(ownerId)) {
        await ctx.reply("I'm a customer support bot.");
        return;
      }

      const state = await this.ownerReplyTargets.getActive(ownerId);
      if (!state) return;

      const text = ctx.message.text;
      if (!text) return;

      try {
        await ctx.api.sendMessage(state.chatId, text, {
          business_connection_id: state.businessConnectionId,
        });
        await this.ownerReplyTargets.markUsed(state.token);
        await ctx.reply("✅ Sent to customer.");
      } catch (e) {
        logger.warn({ err: e, botId: state.botId }, "BUSINESS_PEER_INVALID forwarding owner reply");
        await ctx.reply(
          "⚠️ Couldn't send. Make sure the bot has Business Mode enabled in @BotFather and is added as admin to your Telegram Business account.",
        );
      }
    });
  }

  private async sendTypingAction(
    ctx: Context,
    chatId: number,
    businessConnectionId: string,
    botId: string,
  ): Promise<void> {
    try {
      await ctx.api.sendChatAction(chatId, "typing", {
        business_connection_id: businessConnectionId,
      });
    } catch (err) {
      logger.warn({ err, botId }, "failed to send typing action");
    }
  }

  private async getOrCreateConversation(
    tenantId: string,
    businessConnectionId: string,
    chatId: number,
  ): Promise<typeof conversations.$inferSelect> {
    const existing = await db.query.conversations.findFirst({
      where: and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.telegramChatId, String(chatId)),
      ),
    });
    if (existing) return existing;

    const [conv] = await db.insert(conversations).values({
      tenantId, businessConnectionId, telegramChatId: String(chatId),
    }).returning();
    if (!conv) throw new Error("Failed to create conversation");
    return conv;
  }

  private async loadHistory(conversationId: string): Promise<HistoryEntry[]> {
    const rows = await db.query.messages.findMany({
      where: eq(messages.conversationId, conversationId),
      orderBy: [asc(messages.createdAt)],
      limit: 20,
    });
    return rows.map(r => ({ role: r.role as "user" | "assistant", content: r.content }));
  }

  private findByOwner(ownerTelegramId: string): { botId: string } | null {
    for (const [botId, entry] of this.bots) {
      if (entry.ownerTelegramId === ownerTelegramId) return { botId };
    }
    return null;
  }

  remove(botId: string): void {
    const entry = this.bots.get(botId);
    if (entry) {
      void this.ownerReplyTargets.clearBot(botId).catch((err) => {
        logger.error({ err, botId }, "failed to clear reply targets");
      });
    }
    this.bots.delete(botId);
  }

  has(botId: string): boolean {
    return this.bots.has(botId);
  }

  async load(botId: string): Promise<Bot<Context> | null> {
    return this.get(botId);
  }
}

export const registry = new BotRegistry();
