import { Bot, type Context, InlineKeyboard, session, type SessionFlavor } from "grammy";
import { type Conversation, type ConversationFlavor, conversations as grammyConvs, createConversation } from "@grammyjs/conversations";
import { eq, and, asc } from "drizzle-orm";
import { db } from "@tg-business/db";
import { tenants, tenantBots, conversations as convTable, messages } from "@tg-business/db";
import { decrypt } from "@tg-business/crypto";
import { uploadFile, b2BucketId } from "@tg-business/storage";
import { askAI } from "../services/ai";
import { updateBot, listDocuments, deleteDocument } from "../lib/api";
import { logger } from "../lib/logger";
import {
  createReplyCallbackData,
  DbAdminReplyTargets,
  type AdminReplyTargets,
} from "./admin-reply-targets";

type BaseCtx = Context & SessionFlavor<Record<string, never>>;
type BizCtx = BaseCtx & ConversationFlavor<BaseCtx>;

interface BotEntry {
  bot: Bot<Context>;
  token: string;
  tenantId: string;
  ownerTelegramId: string;
  systemPrompt: string;
  botUsername: string;
  connectedBusinessUserId: string | null;
}

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

const cancelKb = new InlineKeyboard().text("Cancel", "biz_cancel");
const docCancelKb = new InlineKeyboard().text("Cancel", "biz_doc_cancel");

async function showManagementMenu(ctx: Context, botId: string) {
  const botRecord = await db.query.tenantBots.findFirst({
    where: eq(tenantBots.id, botId),
  });
  if (!botRecord) {
    await ctx.reply("Bot not found.");
    return;
  }

  const statusIcon = botRecord.status === "active" ? "✅ Active" : "⏸️ Paused";
  const kb = new InlineKeyboard()
    .text("✏️ Edit Prompt", "biz_edit_prompt")
    .text("📄 Documents", "biz_documents").row();

  const text = `⚙️ @${botRecord.botUsername} Management\n\nStatus: ${statusIcon}\n\nPrompt preview:\n${botRecord.systemPrompt.slice(0, 200)}${botRecord.systemPrompt.length > 200 ? "..." : ""}`;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb });
  } else {
    await ctx.reply(text, { reply_markup: kb });
  }
}

function makeEditPromptConversation(botId: string) {
  return async function editPromptConversation(conversation: Conversation<BaseCtx, BaseCtx>, ctx: BaseCtx) {
    const botRecord = await db.query.tenantBots.findFirst({
      where: eq(tenantBots.id, botId),
    });
    if (!botRecord) {
      await ctx.reply("Bot not found.");
      return;
    }

    await ctx.editMessageText(
      `Current prompt for @${botRecord.botUsername}:\n\n${botRecord.systemPrompt}\n\nSend your new prompt, or press Cancel.`,
      { reply_markup: cancelKb }
    );

    while (true) {
      const response = await conversation.wait();

      if (response.callbackQuery?.data === "biz_cancel") {
        await response.answerCallbackQuery();
        await showManagementMenu(response, botId);
        return;
      }

      const newPrompt = response.message?.text?.trim();
      if (!newPrompt) {
        await ctx.editMessageText("Please send a text message.", { reply_markup: cancelKb });
        continue;
      }

      await updateBot(botId, { systemPrompt: newPrompt });
      await ctx.reply("✅ Prompt updated!");
      await showManagementMenu(ctx, botId);
      return;
    }
  };
}

function makeDocumentManagementConversation(botId: string, tenantId: string, botToken: string) {
  return async function documentMgmtConversation(conversation: Conversation<BaseCtx, BaseCtx>, ctx: BaseCtx) {
    async function showDocsList() {
      const docs = await listDocuments(tenantId);
      const kb = new InlineKeyboard();
      for (const d of docs) {
        const statusIcon = d.status === "ready" ? "✅" : d.status === "failed" ? "❌" : "⏳";
        kb.text(`${statusIcon} ${d.fileName.slice(0, 25)}`, `biz_docitem_${d.id}`)
          .text("🗑️", `biz_del_doc_${d.id}`).row();
      }
      kb.text("➕ Add Document", "biz_add_doc").row();
      kb.text("🔙 Back", "biz_doc_back");

      const text = docs.length === 0
        ? "No documents yet."
        : `📚 ${docs.length} document(s)`;

      await ctx.editMessageText(text, { reply_markup: kb });
    }

    async function confirmDelete(docId: string, fileName: string) {
      const confirmKb = new InlineKeyboard()
        .text("✅ Yes, delete", `biz_confirm_del_${docId}`)
        .text("❌ No", "biz_doc_cancel");
      await ctx.editMessageText(`Delete "${fileName}" and all its data?`, { reply_markup: confirmKb });
    }

    await showDocsList();

    while (true) {
      const response = await conversation.wait();

      if (response.callbackQuery?.data === "biz_doc_back") {
        await response.answerCallbackQuery();
        await showManagementMenu(response, botId);
        return;
      }

      if (response.callbackQuery?.data === "biz_doc_cancel") {
        await response.answerCallbackQuery();
        await showDocsList();
        continue;
      }

      if (response.callbackQuery?.data === "biz_add_doc") {
        await response.answerCallbackQuery();
        await ctx.editMessageText(
          "Send me a PDF file to add as knowledge for this bot.",
          { reply_markup: new InlineKeyboard().text("Cancel", "biz_doc_cancel") },
        );
        continue;
      }

      if (response.callbackQuery?.data?.startsWith("biz_docitem_")) {
        await response.answerCallbackQuery({ text: "Tap 🗑️ to delete this document." });
        continue;
      }

      const delMatch = response.callbackQuery?.data?.match(/^biz_del_doc_(.+)$/);
      if (delMatch) {
        await response.answerCallbackQuery();
        const docId = delMatch[1]!;
        const docs = await listDocuments(tenantId);
        const doc = docs.find(d => d.id === docId);
        await confirmDelete(docId, doc?.fileName ?? "unknown");
        continue;
      }

      const confirmDelMatch = response.callbackQuery?.data?.match(/^biz_confirm_del_(.+)$/);
      if (confirmDelMatch) {
        await response.answerCallbackQuery();
        const docId = confirmDelMatch[1]!;
        try {
          await deleteDocument(docId);
          await ctx.reply("✅ Document deleted.");
        } catch (err) {
          await ctx.reply("❌ Failed to delete.");
        }
        await showDocsList();
        continue;
      }

      const doc = response.message?.document;
      if (!doc || !doc.mime_type?.startsWith("application/pdf")) {
        await ctx.reply("Please send a PDF file, or press Cancel.", {
          reply_markup: docCancelKb,
        });
        continue;
      }

      const workUrl = process.env.WORKER_URL;
      if (!workUrl) {
        await ctx.reply("RAG worker not configured.");
        return;
      }

      await ctx.reply("📥 Downloading PDF...");

      try {
        const file = await ctx.api.getFile(doc.file_id);
        const filePath = file.file_path;
        if (!filePath) {
          await ctx.reply("Could not access the file.");
          await showDocsList();
          continue;
        }

        const pdfUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
        const res = await fetch(pdfUrl);
        const pdfBuffer = Buffer.from(await res.arrayBuffer());

        await ctx.reply("📤 Uploading to storage...");

        const b2Path = `tenants/${tenantId}/docs/${crypto.randomUUID()}.pdf`;
        const { fileId, fileName: b2FileName } = await uploadFile(
          b2BucketId(),
          b2Path,
          pdfBuffer,
          "application/pdf",
        );

        await ctx.reply("🔍 Sending for processing...");

        const ingestRes = await fetch(`${workUrl}/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            b2FileId: fileId,
            b2FileName,
            tenantId,
            fileName: doc.file_name ?? "untitled.pdf",
            mimeType: "application/pdf",
          }),
        });

        if (!ingestRes.ok) {
          const errBody = await ingestRes.json().catch(() => ({}));
          throw new Error((errBody as { error?: string }).error ?? "ingest failed");
        }

        logger.info({ documentId: (await ingestRes.json() as { documentId: string }).documentId, fileName: doc.file_name }, "PDF queued for processing");
        await ctx.reply("✅ PDF queued for processing!");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logger.error({ err, fileName: doc.file_name }, "PDF ingestion failed");
        await ctx.reply(`❌ Failed to process PDF: ${msg}`);
      }

      await showDocsList();
    }
  };
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

    const bot = this.buildBizBot(rawToken, botId, row.tenantId);
    await bot.init();
    this.attachHandlers(bot, botId, tenant.telegramOwnerId, row.systemPrompt, row.botUsername ?? "");
    this.bots.set(botId, {
      bot, token: rawToken, tenantId: row.tenantId,
      ownerTelegramId: tenant.telegramOwnerId, systemPrompt: row.systemPrompt,
      botUsername: row.botUsername ?? "",
      connectedBusinessUserId: row.connectedBusinessUserId,
    });
    return bot;
  }

  private buildBizBot(rawToken: string, botId: string, tenantId: string): Bot<Context> {
    const bot = new Bot<BizCtx>(rawToken);
    bot.use(session({ initial: () => ({}) }));
    bot.use(grammyConvs());
    bot.use(createConversation(makeEditPromptConversation(botId), "editPrompt"));
    bot.use(createConversation(makeDocumentManagementConversation(botId, tenantId, rawToken), "documentMgmt"));
    return bot as unknown as Bot<Context>;
  }

  private async createBot(row: typeof tenantBots.$inferSelect, token: string, tenant: typeof tenants.$inferSelect): Promise<Bot<Context>> {
    const bot = this.buildBizBot(token, row.id, row.tenantId);
    await bot.init();
    this.attachHandlers(bot, row.id, tenant.telegramOwnerId, row.systemPrompt, row.botUsername ?? "");
    this.bots.set(row.id, {
      bot, token, tenantId: row.tenantId,
      ownerTelegramId: tenant.telegramOwnerId, systemPrompt: row.systemPrompt,
      botUsername: row.botUsername ?? "",
      connectedBusinessUserId: row.connectedBusinessUserId,
    });
    return bot;
  }

  private attachHandlers(
    bot: Bot<Context>,
    botId: string,
    ownerTelegramId: string,
    systemPrompt: string,
    businessName: string,
  ): void {
    // --- Owner management ---

    bot.command("start", async (ctx) => {
      if (!this.findByOwner(String(ctx.from?.id ?? ""))) return;
      await showManagementMenu(ctx, botId);
    });

    bot.callbackQuery("biz_edit_prompt", async (ctx) => {
      await ctx.answerCallbackQuery();
      await (ctx as unknown as BizCtx).conversation.enter("editPrompt");
    });

    bot.callbackQuery("biz_documents", async (ctx) => {
      await ctx.answerCallbackQuery();
      await (ctx as unknown as BizCtx).conversation.enter("documentMgmt");
    });

    // --- Business connection ---

    bot.on("business_connection", async (ctx) => {
      const conn = ctx.update.business_connection;
      if (!conn?.user) return;

      const botEntry = this.bots.get(botId);
      if (!botEntry) return;

      const userId = String(conn.user.id);
      if (botEntry.connectedBusinessUserId && botEntry.connectedBusinessUserId !== userId) {
        logger.warn({ botId, expected: botEntry.connectedBusinessUserId, got: userId }, "business connection blocked — already connected to another user");
        return;
      }

      if (!botEntry.connectedBusinessUserId) {
        botEntry.connectedBusinessUserId = userId;
        await db.update(tenantBots).set({ connectedBusinessUserId: userId }).where(eq(tenantBots.id, botId));
        logger.info({ botId, userId }, "business connection authorized");
      }
    });

    // --- Business messages (customer chat) ---

    bot.on("business_message").filter(
      async (ctx) => {
        const conn = await ctx.getBusinessConnection();
        if (ctx.from?.id === conn.user.id) return false;

        const botEntry = this.bots.get(botId);
        if (!botEntry) return false;

        const userId = String(conn.user.id);
        if (botEntry.connectedBusinessUserId && botEntry.connectedBusinessUserId !== userId) {
          logger.warn({ botId, expected: botEntry.connectedBusinessUserId, got: userId }, "business message blocked — wrong business account");
          return false;
        }

        if (!botEntry.connectedBusinessUserId) {
          botEntry.connectedBusinessUserId = userId;
          await db.update(tenantBots).set({ connectedBusinessUserId: userId }).where(eq(tenantBots.id, botId));
          logger.info({ botId, userId }, "business connection authorized via first message");
        }

        return true;
      },
      async (ctx) => {
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
          tenantId,
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

      if (result.text !== null) {
        await db.insert(messages).values({
          conversationId: conv.id, tenantId,
          role: "assistant", content: result.text,
        });
        await db.update(convTable).set({ lastMessageAt: new Date() }).where(eq(convTable.id, conv.id));

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

    // --- Direct messages (owner) ---

    bot.on("message", async (ctx) => {
      if (!ctx.from) return;
      const ownerId = String(ctx.from.id);

      if (!this.findByOwner(ownerId)) {
        await ctx.reply("I'm a customer support bot.");
        return;
      }

      const state = await this.ownerReplyTargets.getActive(ownerId);
      if (state && ctx.message.text) {
        try {
          await ctx.api.sendMessage(state.chatId, ctx.message.text, {
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
        return;
      }

      if (ctx.message.text) {
        await showManagementMenu(ctx, botId);
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
  ): Promise<typeof convTable.$inferSelect> {
    const existing = await db.query.conversations.findFirst({
      where: and(
        eq(convTable.tenantId, tenantId),
        eq(convTable.telegramChatId, String(chatId)),
      ),
    });
    if (existing) return existing;

    const [conv] = await db.insert(convTable).values({
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
