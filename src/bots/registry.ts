import { Bot, type Context, InlineKeyboard } from "grammy";
import { eq, and, asc } from "drizzle-orm";
import { db } from "../db";
import { tenants, tenantBots, conversations, messages } from "../db/schema";
import { decrypt } from "../lib/crypto";
import { askAI } from "../services/ai";

interface BotEntry {
  bot: Bot<Context>;
  token: string;
  tenantId: string;
  ownerTelegramId: string;
  systemPrompt: string;
  botUsername: string;
}

interface OwnerReplyState {
  chatId: number;
  businessConnectionId: string;
}

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

interface TransferState {
  ownerTelegramId: string;
  step: "awaiting_message";
}

export class BotRegistry {
  private bots = new Map<string, BotEntry>();
  private ownerReplies = new Map<string, OwnerReplyState>();
  private transfers = new Map<string, TransferState>();

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
      if (!msg?.text) return;

      const question = msg.text;
      const connId = msg.business_connection_id;
      const chatId = msg.chat.id;
      const convKey = `${botId}_${chatId}`;

      // Check for pending transfer — forward customer's message to owner with Reply button
      const pendingTransfer = this.transfers.get(convKey);
      if (pendingTransfer) {
        this.transfers.delete(convKey);
        const replyKey = `${botId}_${ownerTelegramId}`;
        this.ownerReplies.set(replyKey, { chatId, businessConnectionId: connId });
        const kb = new InlineKeyboard().text("✏️ Reply", `oreply_${replyKey}`);
        await ctx.api.sendMessage(Number(ownerTelegramId), `💬 Customer says:\n\n${question}`, { reply_markup: kb });
        await ctx.api.sendMessage(chatId, "✅ Sent to the admin. They'll get back to you.", { business_connection_id: connId });
        return;
      }

      const botEntry = this.bots.get(botId);
      const tenantId = botEntry!.tenantId;
      const conv = await this.getOrCreateConversation(tenantId, connId, chatId);

      await db.insert(messages).values({
        conversationId: conv.id, tenantId,
        role: "user", content: question, telegramMessageId: String(msg.message_id),
      });

      const dbHistory = await this.loadHistory(conv.id);

      const result = await askAI(question, businessName, systemPrompt, dbHistory).catch((err) => {
        console.error(`AI error for bot ${botId}:`, err);
        return { text: null };
      });

      // Model decided to transfer to admin
      if (result.transfer) {
        this.transfers.set(convKey, { ownerTelegramId, step: "awaiting_message" });
        await ctx.api.sendMessage(chatId, "What message would you like me to send to the admin?", { business_connection_id: connId });
        return;
      }

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
          console.error(`BUSINESS_PEER_INVALID for bot ${botId}, conn ${connId}:`, e);
          await ctx.api.sendMessage(
            Number(ownerTelegramId),
            `⚠️ Failed to reply to customer. Make sure the bot has Business Mode enabled in @BotFather and is added as admin to your Telegram Business account.\n\nCustomer asked: ${question}`,
          );
        }
        return;
      }

      // Model returned UNSURE — forward to owner
      const replyKey = `${botId}_${ownerTelegramId}`;
      this.ownerReplies.set(replyKey, { chatId, businessConnectionId: connId });

      const kb = new InlineKeyboard().text("✏️ Reply", `oreply_${replyKey}`);
      await ctx.api.sendMessage(
        Number(ownerTelegramId),
        `💬 Customer question for @${businessName}:\n\n${question}`,
        { reply_markup: kb },
      );
    });

    bot.callbackQuery(/^oreply_(.+)$/, async (ctx) => {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText("Send your reply to forward to the customer.");
    });

    bot.on("message", async (ctx) => {
      if (!ctx.from) return;
      const ownerId = String(ctx.from.id);

      const entry = this.findByOwner(ownerId);
      if (!entry) {
        await ctx.reply("I'm a customer support bot.");
        return;
      }

      const replyKey = `${entry.botId}_${ownerId}`;
      const state = this.ownerReplies.get(replyKey);
      if (!state) return;

      const text = ctx.message.text;
      if (!text) return;

      try {
        await ctx.api.sendMessage(state.chatId, text, {
          business_connection_id: state.businessConnectionId,
        });
        this.ownerReplies.delete(replyKey);
        await ctx.reply("✅ Sent to customer.");
      } catch (e) {
        console.error(`BUSINESS_PEER_INVALID forwarding reply for bot ${entry.botId}:`, e);
        await ctx.reply(
          "⚠️ Couldn't send. Make sure the bot has Business Mode enabled in @BotFather and is added as admin to your Telegram Business account.",
        );
      }
    });
  }

  private async getOrCreateConversation(tenantId: string, businessConnectionId: string, chatId: number) {
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
      for (const [key] of this.ownerReplies) {
        if (key.startsWith(`${botId}_`)) this.ownerReplies.delete(key);
      }
      for (const [key] of this.transfers) {
        if (key.startsWith(`${botId}_`)) this.transfers.delete(key);
      }
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
