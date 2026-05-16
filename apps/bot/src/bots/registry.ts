import {
  Bot,
  type Context,
  InlineKeyboard,
  session,
  type SessionFlavor,
} from "grammy";
import {
  type Conversation,
  type ConversationFlavor,
  conversations as grammyConvs,
  createConversation,
} from "@grammyjs/conversations";
import { eq, and, asc } from "drizzle-orm";
import { db } from "@tg-business/db";
import {
  tenants,
  tenantBots,
  conversations as convTable,
  messages,
} from "@tg-business/db";
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
import { renderCustomerWelcome } from "./welcome";
import { detectMimeType } from "./document-types";
import {
  checkDocumentLimits,
  formatBytes,
  MAX_DOCUMENT_SIZE_BYTES,
  MAX_DOCUMENTS_PER_BOT,
} from "./document-limits";
import { escapeHtml, markdownToTelegramHtml } from "../lib/markdown-to-html";
import { createScreen } from "../lib/screen";

type BaseCtx = Context & SessionFlavor<Record<string, never>>;
type BizCtx = BaseCtx & ConversationFlavor<BaseCtx>;

interface BotEntry {
  bot: Bot<Context>;
  token: string;
  tenantId: string;
  ownerTelegramId: string;
  systemPrompt: string;
  welcomeMessage: string | null;
  botUsername: string;
  connectedBusinessUserId: string | null;
  webhookSecret: string;
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
    .text("💬 Welcome Message", "biz_edit_welcome")
    .row()
    .text("📄 Documents", "biz_documents")
    .row();

  const text = `⚙️ @${botRecord.botUsername} Management\n\nStatus: ${statusIcon}\n\nPrompt preview:\n${botRecord.systemPrompt.slice(0, 200)}${botRecord.systemPrompt.length > 200 ? "..." : ""}`;

  // Always send a new message. Conversations that own a screen via
  // createScreen() are expected to call screen.clear() before invoking
  // this — that's the documented contract for the post-conversation path.
  await ctx.reply(text, { reply_markup: kb });
}

function makeEditPromptConversation(botId: string) {
  return async function editPromptConversation(
    conversation: Conversation<BaseCtx, BaseCtx>,
    ctx: BaseCtx,
  ) {
    const botRecord = await db.query.tenantBots.findFirst({
      where: eq(tenantBots.id, botId),
    });
    if (!botRecord) {
      await ctx.reply("Bot not found.");
      return;
    }

    const screen = createScreen(ctx);
    await screen.show(
      `Current prompt for @${botRecord.botUsername}:\n\n${botRecord.systemPrompt}\n\nSend your new prompt, or press Cancel.`,
      { reply_markup: cancelKb },
    );

    while (true) {
      const response = await conversation.wait();

      if (response.callbackQuery?.data === "biz_cancel") {
        await response.answerCallbackQuery();
        await screen.clear();
        await showManagementMenu(response, botId);
        return;
      }

      const newPrompt = response.message?.text?.trim();
      if (!newPrompt) {
        await screen.show("Please send a text message.", {
          reply_markup: cancelKb,
        });
        continue;
      }

      // updateBot must be wrapped so a later replay (e.g. owner navigates
      // back, or any subsequent update inside this conversation) does not
      // re-issue the DB write.
      await conversation.external(() =>
        updateBot(botId, { systemPrompt: newPrompt }),
      );
      await screen.clear();
      await ctx.reply("✅ Prompt updated!");
      await showManagementMenu(ctx, botId);
      return;
    }
  };
}

function makeEditWelcomeConversation(
  botId: string,
  onSaved: (newValue: string | null) => void,
) {
  return async function editWelcomeConversation(
    conversation: Conversation<BaseCtx, BaseCtx>,
    ctx: BaseCtx,
  ) {
    const botRecord = await db.query.tenantBots.findFirst({
      where: eq(tenantBots.id, botId),
    });
    if (!botRecord) {
      await ctx.reply("Bot not found.");
      return;
    }

    const kb = new InlineKeyboard()
      .text("↺ Reset to default", "biz_welcome_reset")
      .row()
      .text("Cancel", "biz_cancel");

    const current = botRecord.welcomeMessage?.trim()
      ? `Current welcome message:\n\n${botRecord.welcomeMessage}`
      : "No custom welcome message — the default is shown to customers.";

    const screen = createScreen(ctx);
    await screen.show(
      `${current}\n\nSend a new welcome message, or use the buttons below.`,
      { reply_markup: kb },
    );

    while (true) {
      const response = await conversation.wait();

      if (response.callbackQuery?.data === "biz_cancel") {
        await response.answerCallbackQuery();
        await screen.clear();
        await showManagementMenu(response, botId);
        return;
      }

      if (response.callbackQuery?.data === "biz_welcome_reset") {
        await response.answerCallbackQuery();
        // Replay-safety: keep the DB write + in-memory cache update inside
        // a single external so a later replay does not re-run them.
        await conversation.external(async () => {
          await updateBot(botId, { welcomeMessage: null });
          onSaved(null);
        });
        await screen.clear();
        await response.reply("✅ Welcome message reset to default.");
        await showManagementMenu(response, botId);
        return;
      }

      const newWelcome = response.message?.text?.trim();
      if (!newWelcome) {
        await screen.show("Please send a text message.", {
          reply_markup: kb,
        });
        continue;
      }

      await conversation.external(async () => {
        await updateBot(botId, { welcomeMessage: newWelcome });
        onSaved(newWelcome);
      });
      await screen.clear();
      await ctx.reply("✅ Welcome message updated!");
      await showManagementMenu(ctx, botId);
      return;
    }
  };
}

function makeDocumentManagementConversation(
  botId: string,
  tenantId: string,
  botToken: string,
) {
  return async function documentMgmtConversation(
    conversation: Conversation<BaseCtx, BaseCtx>,
    ctx: BaseCtx,
  ) {
    const screen = createScreen(ctx);

    async function showDocsList() {
      const docs = await listDocuments(botId);
      const kb = new InlineKeyboard();
      for (const d of docs) {
        const statusIcon =
          d.status === "ready" ? "✅" : d.status === "failed" ? "❌" : "⏳";
        kb.text(
          `${statusIcon} ${d.fileName.slice(0, 25)}`,
          `biz_docitem_${d.id}`,
        )
          .text("🗑️", `biz_del_doc_${d.id}`)
          .row();
      }
      kb.text("➕ Add Document", "biz_add_doc").row();
      kb.text("🔙 Back", "biz_doc_back");

      const text =
        docs.length === 0
          ? `No documents yet. (Up to ${MAX_DOCUMENTS_PER_BOT}, ${formatBytes(MAX_DOCUMENT_SIZE_BYTES)} each.)`
          : `📚 ${docs.length}/${MAX_DOCUMENTS_PER_BOT} documents`;

      await screen.show(text, { reply_markup: kb });
    }

    async function confirmDelete(docId: string, fileName: string) {
      const confirmKb = new InlineKeyboard()
        .text("✅ Yes, delete", `biz_confirm_del_${docId}`)
        .text("❌ No", "biz_doc_cancel");
      await screen.show(`Delete "${fileName}" and all its data?`, {
        reply_markup: confirmKb,
      });
    }

    await showDocsList();

    while (true) {
      const response = await conversation.wait();

      if (response.callbackQuery?.data === "biz_doc_back") {
        await response.answerCallbackQuery();
        await screen.clear();
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
        const existing = await listDocuments(botId);
        if (existing.length >= MAX_DOCUMENTS_PER_BOT) {
          await screen.show(
            `❌ You've reached the ${MAX_DOCUMENTS_PER_BOT}-document limit. Delete one before adding another.`,
            {
              reply_markup: new InlineKeyboard().text(
                "🔙 Back",
                "biz_doc_cancel",
              ),
            },
          );
          continue;
        }
        await screen.show(
          `Send me a document to add as knowledge for this bot.\n\nSupported: PDF, TXT, Markdown (.md), Word (.docx), HTML.\n\nMax ${formatBytes(MAX_DOCUMENT_SIZE_BYTES)} per file, up to ${MAX_DOCUMENTS_PER_BOT} documents per bot.`,
          {
            reply_markup: new InlineKeyboard().text("Cancel", "biz_doc_cancel"),
          },
        );
        continue;
      }

      if (response.callbackQuery?.data?.startsWith("biz_docitem_")) {
        await response.answerCallbackQuery({
          text: "Tap 🗑️ to delete this document.",
        });
        continue;
      }

      const delMatch =
        response.callbackQuery?.data?.match(/^biz_del_doc_(.+)$/);
      if (delMatch) {
        await response.answerCallbackQuery();
        const docId = delMatch[1]!;
        const docs = await listDocuments(botId);
        const doc = docs.find((d) => d.id === docId);
        await confirmDelete(docId, doc?.fileName ?? "unknown");
        continue;
      }

      const confirmDelMatch = response.callbackQuery?.data?.match(
        /^biz_confirm_del_(.+)$/,
      );
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
      const detectedMime = doc
        ? detectMimeType(doc.file_name, doc.mime_type)
        : null;
      if (!doc || !detectedMime) {
        await ctx.reply(
          "Please send a supported file (PDF, TXT, Markdown, DOCX, or HTML), or press Cancel.",
          { reply_markup: docCancelKb },
        );
        continue;
      }

      const existing = await listDocuments(botId);
      const limitCheck = checkDocumentLimits({
        fileSize: doc.file_size,
        currentDocCount: existing.length,
      });
      if (!limitCheck.ok) {
        if (limitCheck.reason === "too_many") {
          await ctx.reply(
            `❌ You've reached the ${limitCheck.limit}-document limit. Delete one before adding another.`,
            { reply_markup: docCancelKb },
          );
        } else {
          await ctx.reply(
            `❌ File is too large (${formatBytes(limitCheck.size)}). Max ${formatBytes(limitCheck.limit)} per file.`,
            { reply_markup: docCancelKb },
          );
        }
        continue;
      }

      const workUrl = process.env.WORKER_URL;
      if (!workUrl) {
        await ctx.reply("RAG worker not configured.");
        return;
      }

      await ctx.reply("📥 Processing document…");

      const file = await ctx.api.getFile(doc.file_id);
      const filePath = file.file_path;
      if (!filePath) {
        await ctx.reply("Could not access the file.");
        await showDocsList();
        continue;
      }

      // All side effects below must live inside `conversation.external` so
      // they don't re-run when the conversation handler replays on the next
      // update (e.g. when the owner presses Back). Re-running would re-upload
      // to B2 and re-POST /ingest, creating duplicate document rows.
      let queued = false;
      try {
        await conversation.external(async () => {
          const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
          const res = await fetch(fileUrl);
          const fileBuffer = Buffer.from(await res.arrayBuffer());

          const ext = doc.file_name?.split(".").pop()?.toLowerCase();
          const b2Path = `tenants/${tenantId}/docs/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
          const { fileId, fileName: b2FileName } = await uploadFile(
            b2BucketId(),
            b2Path,
            fileBuffer,
            detectedMime,
          );

          const ingestRes = await fetch(`${workUrl}/ingest`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              b2FileId: fileId,
              b2FileName,
              tenantId,
              botId,
              fileName: doc.file_name ?? "untitled",
              mimeType: detectedMime,
            }),
          });

          if (!ingestRes.ok) {
            const errBody = await ingestRes.json().catch(() => ({}));
            throw new Error(
              (errBody as { error?: string }).error ?? "ingest failed",
            );
          }

          const ingestBody = (await ingestRes.json()) as { documentId: string };
          logger.info(
            {
              documentId: ingestBody.documentId,
              fileName: doc.file_name,
              mimeType: detectedMime,
            },
            "document queued for processing",
          );
        });
        queued = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logger.error({ err, fileName: doc.file_name }, "document ingestion failed");
        await ctx.reply(`❌ Failed to process document: ${msg}`);
      }

      if (queued) {
        await ctx.reply("✅ Document queued for processing!");
      }

      await showDocsList();
    }
  };
}

export class BotRegistry {
  private bots = new Map<string, BotEntry>();

  constructor(
    private ownerReplyTargets: AdminReplyTargets = new DbAdminReplyTargets(),
  ) {}

  async get(botId: string): Promise<Bot<Context> | null> {
    const existing = this.bots.get(botId);
    if (existing) {
      const row = await db.query.tenantBots.findFirst({
        where: eq(tenantBots.id, botId),
        columns: { status: true },
      });
      if (!row || row.status !== "active") {
        this.bots.delete(botId);
        return null;
      }
      return existing.bot;
    }

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
    const row = await db.query.tenantBots.findFirst({
      where: eq(tenantBots.id, botId),
    });
    if (!row) throw new Error("Bot not found in DB after insert");

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, row.tenantId),
    });
    if (!tenant) throw new Error("Tenant not found");

    const bot = this.buildBizBot(rawToken, botId, row.tenantId);
    await bot.init();
    await this.setWebhook(bot, botId, row.webhookSecret);
    this.attachHandlers(
      bot,
      botId,
      tenant.telegramOwnerId,
      row.systemPrompt,
      row.botUsername ?? "",
    );
    this.bots.set(botId, {
      bot,
      token: rawToken,
      tenantId: row.tenantId,
      ownerTelegramId: tenant.telegramOwnerId,
      systemPrompt: row.systemPrompt,
      welcomeMessage: row.welcomeMessage,
      botUsername: row.botUsername ?? "",
      connectedBusinessUserId: row.connectedBusinessUserId,
      webhookSecret: row.webhookSecret,
    });
    return bot;
  }

  private buildBizBot(
    rawToken: string,
    botId: string,
    tenantId: string,
  ): Bot<Context> {
    const bot = new Bot<BizCtx>(rawToken);
    bot.use(session({ initial: () => ({}) }));
    bot.use(grammyConvs());
    bot.use(
      createConversation(makeEditPromptConversation(botId), "editPrompt"),
    );
    bot.use(
      createConversation(
        makeEditWelcomeConversation(botId, (newValue) => {
          const entry = this.bots.get(botId);
          if (entry) entry.welcomeMessage = newValue;
        }),
        "editWelcome",
      ),
    );
    bot.use(
      createConversation(
        makeDocumentManagementConversation(botId, tenantId, rawToken),
        "documentMgmt",
      ),
    );
    return bot as unknown as Bot<Context>;
  }

  private async createBot(
    row: typeof tenantBots.$inferSelect,
    token: string,
    tenant: typeof tenants.$inferSelect,
  ): Promise<Bot<Context>> {
    const bot = this.buildBizBot(token, row.id, row.tenantId);
    await bot.init();
    await this.setWebhook(bot, row.id, row.webhookSecret);
    this.attachHandlers(
      bot,
      row.id,
      tenant.telegramOwnerId,
      row.systemPrompt,
      row.botUsername ?? "",
    );
    this.bots.set(row.id, {
      bot,
      token,
      tenantId: row.tenantId,
      ownerTelegramId: tenant.telegramOwnerId,
      systemPrompt: row.systemPrompt,
      welcomeMessage: row.welcomeMessage,
      botUsername: row.botUsername ?? "",
      connectedBusinessUserId: row.connectedBusinessUserId,
      webhookSecret: row.webhookSecret,
    });
    return bot;
  }

  private async setWebhook(bot: Bot<Context>, botId: string, secret: string): Promise<void> {
    const publicUrl = process.env.PUBLIC_URL;
    if (!publicUrl) return;
    try {
      await bot.api.setWebhook(`${publicUrl}/webhook/tenant/${botId}`, {
        drop_pending_updates: true,
        secret_token: secret,
      });
    } catch (err) {
      logger.error({ err, botId }, "failed to set tenant webhook");
    }
  }

  getWebhookSecret(botId: string): string | null {
    return this.bots.get(botId)?.webhookSecret ?? null;
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
      const ownerId = String(ctx.from?.id ?? "");
      if (this.findByOwner(ownerId)) {
        await showManagementMenu(ctx, botId);
        return;
      }

      // Non-owner: send the (custom or default) welcome.
      const botEntry = this.bots.get(botId);
      const { text, keyboard } = renderCustomerWelcome({
        welcomeMessage: botEntry?.welcomeMessage,
        connectedBusinessUserId: botEntry?.connectedBusinessUserId ?? null,
      });
      await ctx.reply(text, keyboard ? { reply_markup: keyboard } : {});
    });

    bot.callbackQuery("biz_edit_prompt", async (ctx) => {
      await ctx.answerCallbackQuery();
      await (ctx as unknown as BizCtx).conversation.enter("editPrompt");
    });

    bot.callbackQuery("biz_edit_welcome", async (ctx) => {
      await ctx.answerCallbackQuery();
      await (ctx as unknown as BizCtx).conversation.enter("editWelcome");
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
      if (
        botEntry.connectedBusinessUserId &&
        botEntry.connectedBusinessUserId !== userId
      ) {
        logger.warn(
          { botId, expected: botEntry.connectedBusinessUserId, got: userId },
          "business connection blocked — already connected to another user",
        );
        return;
      }

      if (!botEntry.connectedBusinessUserId) {
        botEntry.connectedBusinessUserId = userId;
        await db
          .update(tenantBots)
          .set({ connectedBusinessUserId: userId })
          .where(eq(tenantBots.id, botId));
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
        if (
          botEntry.connectedBusinessUserId &&
          botEntry.connectedBusinessUserId !== userId
        ) {
          logger.warn(
            { botId, expected: botEntry.connectedBusinessUserId, got: userId },
            "business message blocked — wrong business account",
          );
          return false;
        }

        if (!botEntry.connectedBusinessUserId) {
          botEntry.connectedBusinessUserId = userId;
          await db
            .update(tenantBots)
            .set({ connectedBusinessUserId: userId })
            .where(eq(tenantBots.id, botId));
          logger.info(
            { botId, userId },
            "business connection authorized via first message",
          );
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

        const from = msg.from;
        const name = from
          ? `${from.first_name}${from.last_name ? ` ${from.last_name}` : ""}`
          : "Unknown";
        const tag = from?.username ? ` (@${from.username})` : "";
        const customerLabel = `👤 ${name}${tag} — ID: ${from?.id ?? "?"}`;

        const botEntry = this.bots.get(botId);
        if (!botEntry) {
          logger.error({ botId }, "no bot entry loaded");
          return;
        }
        const tenantId = botEntry.tenantId;
        const conv = await this.getOrCreateConversation(
          tenantId,
          connId,
          chatId,
        );
        const dbHistory = await this.loadHistory(conv.id);

        await db.insert(messages).values({
          conversationId: conv.id,
          tenantId,
          role: "user",
          content: question,
          telegramMessageId: String(msg.message_id),
        });

        await this.sendTypingAction(ctx, chatId, connId, botId);

        const result: Awaited<ReturnType<typeof askAI>> = await askAI(
          question,
          businessName,
          systemPrompt,
          dbHistory,
          {
            botId,
            sendAdminMessage: async ({ message }) => {
              try {
                const replyToken = await this.ownerReplyTargets.create({
                  botId,
                  chatId,
                  businessConnectionId: connId,
                });
                const kb = new InlineKeyboard().text(
                  "✏️ Reply",
                  createReplyCallbackData(replyToken),
                );
                await ctx.api.sendMessage(
                  Number(ownerTelegramId),
                  `${escapeHtml(customerLabel)}\n\n💬 ${markdownToTelegramHtml(message)}`,
                  { reply_markup: kb, parse_mode: "HTML" },
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
            conversationId: conv.id,
            tenantId,
            role: "assistant",
            content: result.text,
          });
          await db
            .update(convTable)
            .set({ lastMessageAt: new Date() })
            .where(eq(convTable.id, conv.id));

          const renderedText = markdownToTelegramHtml(result.text);
          try {
            await ctx.api.sendMessage(chatId, renderedText, {
              business_connection_id: connId,
              parse_mode: "HTML",
            });
          } catch (e) {
            try {
              // Fall back without parse_mode. Send the original AI output
              // (markdown) so the customer at least gets a readable reply
              // instead of stray <b>/<pre> tags as literal text.
              await ctx.api.sendMessage(chatId, result.text, {
                business_connection_id: connId,
              });
            } catch (e2) {
              logger.warn(
                { err: e, botId, connId },
                "BUSINESS_PEER_INVALID sending answer",
              );
              await ctx.api.sendMessage(
                Number(ownerTelegramId),
                `⚠️ Failed to reply to customer. Make sure the bot has Business Mode enabled in @BotFather and is added to your Telegram Business account and ensure it has the necessary permissions.\n\n${customerLabel}\n\nCustomer asked: ${question}`,
              );
            }
          }
          return;
        }
      },
    );

    // --- Direct messages (owner) ---

    bot.on("message", async (ctx) => {
      if (!ctx.from) return;
      const ownerId = String(ctx.from.id);

      if (!this.findByOwner(ownerId)) {
        const botEntry = this.bots.get(botId);
        const { text, keyboard } = renderCustomerWelcome({
          welcomeMessage: botEntry?.welcomeMessage,
          connectedBusinessUserId: botEntry?.connectedBusinessUserId ?? null,
        });
        await ctx.reply(text, keyboard ? { reply_markup: keyboard } : {});
        return;
      }

      const state = await this.ownerReplyTargets.getActive(ownerId);
      if (state && ctx.message.text) {
        try {
          // The owner typed this in their client. Treat as plain text and
          // escape <, >, & so the HTML parser doesn't reject anything they
          // happen to type (e.g. "if a < b").
          await ctx.api.sendMessage(state.chatId, escapeHtml(ctx.message.text), {
            business_connection_id: state.businessConnectionId,
            parse_mode: "HTML",
          });
          await this.ownerReplyTargets.markUsed(state.token);
          await ctx.reply("✅ Sent to customer.");
        } catch (e) {
          logger.warn(
            { err: e, botId: state.botId },
            "BUSINESS_PEER_INVALID forwarding owner reply",
          );
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
        eq(convTable.businessConnectionId, businessConnectionId),
      ),
    });
    if (existing) return existing;

    const [conv] = await db
      .insert(convTable)
      .values({
        tenantId,
        businessConnectionId,
        telegramChatId: String(chatId),
      })
      .returning();
    if (!conv) throw new Error("Failed to create conversation");
    return conv;
  }

  private async loadHistory(conversationId: string): Promise<HistoryEntry[]> {
    const rows = await db.query.messages.findMany({
      where: eq(messages.conversationId, conversationId),
      orderBy: [asc(messages.createdAt)],
      limit: 20,
    });
    return rows.map((r) => ({
      role: r.role as "user" | "assistant",
      content: r.content,
    }));
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
