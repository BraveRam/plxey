import { Bot, type Context, session, InlineKeyboard, type SessionFlavor } from "grammy";
import { type Conversation, type ConversationFlavor, conversations, createConversation } from "@grammyjs/conversations";
import { api } from "../api/client";
import { logger } from "../lib/logger";
import { uploadFile, b2BucketId } from "../lib/b2";

type MyContext = Context & SessionFlavor<{ manageBotId?: string }>;
type BotContext = MyContext & ConversationFlavor<MyContext>;

const menuKb = new InlineKeyboard()
  .text("🤖 Create Bot", "create_bot")
  .text("⚙️ Manage", "manage");

const cancelKb = new InlineKeyboard().text("Cancel", "cancel");

// --- Helpers ---

async function botsListKb(userId: string) {
  const bots = await api.listBots(userId);

  const kb = new InlineKeyboard();
  for (const b of bots) {
    const label = b.botUsername ? `@${b.botUsername}` : b.id.slice(0, 8);
    const statusIcon = b.status === "active" ? "✅" : "⏸️";
    kb.text(`${statusIcon} ${label}`, `bot_${b.id}`).row();
  }
  kb.text("🤖 + New Bot", "create_bot").row();
  kb.text("🔙 Back", "menu");
  return { kb, bots };
}

async function showBotSettings(ctx: MyContext, botId: string) {
  const bots = await api.listBots(String(ctx.from!.id));
  const botRecord = bots.find(b => b.id === botId);
  if (!botRecord) {
    await ctx.editMessageText("Bot not found.", { reply_markup: menuKb });
    return;
  }

  const statusIcon = botRecord.status === "active" ? "✅ Active" : "⏸️ Paused";
  const kb = new InlineKeyboard();

  if (botRecord.status === "active") {
    kb.text("⏸️ Pause", `pause_${botId}`);
  } else {
    kb.text("▶️ Resume", `resume_${botId}`);
  }
  kb.text("✏️ Prompt", "edit_prompt").row();
  kb.text("📄 Documents", `documents_${botId}`).row();
  kb.text("🗑️ Delete", `delete_${botId}`).row();
  kb.text("🔙 Back", "manage");

  await ctx.editMessageText(
    `🤖 @${botRecord.botUsername}\n` +
    `Status: ${statusIcon}\n\n` +
    `Prompt preview:\n${botRecord.systemPrompt.slice(0, 200)}${botRecord.systemPrompt.length > 200 ? "..." : ""}`,
    { reply_markup: kb }
  );
}

// --- Conversations ---

async function createBotConversation(conversation: Conversation<MyContext, MyContext>, ctx: MyContext) {
  await ctx.editMessageText(
    "Send me your bot token.\n\n" +
    "1. Create a bot via @BotFather\n" +
    "2. Enable Business Mode in BotFather settings\n" +
    "3. Paste the token here",
    { reply_markup: cancelKb }
  );

  while (true) {
    const response = await conversation.wait();

    if (response.callbackQuery?.data === "cancel") {
      await response.answerCallbackQuery();
      await response.editMessageText("Main menu:", { reply_markup: menuKb });
      return;
    }

    const token = response.message?.text?.trim();
    if (!token) {
      await ctx.reply("Please send a valid token.", { reply_markup: cancelKb });
      continue;
    }

    try {
      const userId = String(ctx.from!.id);
      const botRecord = await api.createBot(token, userId);
      logger.info({ botUsername: botRecord.botUsername, userId }, "onboarding: bot created");
      await ctx.reply(`✅ Bot @${botRecord.botUsername} connected!`, { reply_markup: menuKb });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.includes("Invalid")) {
        await ctx.reply("Invalid token. Try again.", { reply_markup: cancelKb });
      } else {
        await ctx.reply(msg, { reply_markup: menuKb });
        return;
      }
    }
  }
}

async function customizePromptConversation(conversation: Conversation<MyContext, MyContext>, ctx: MyContext) {
  const botId = ctx.session.manageBotId;
  if (!botId) {
    await ctx.editMessageText("No bot selected.", { reply_markup: menuKb });
    return;
  }

  const bots = await api.listBots(String(ctx.from!.id));
  const botRecord = bots.find(b => b.id === botId);
  if (!botRecord) {
    await ctx.editMessageText("Bot not found.", { reply_markup: menuKb });
    return;
  }

  await ctx.editMessageText(
    `Current prompt for @${botRecord.botUsername}:\n\n${botRecord.systemPrompt}\n\nSend your new prompt, or press Cancel.`,
    { reply_markup: cancelKb }
  );

  while (true) {
    const response = await conversation.wait();

    if (response.callbackQuery?.data === "cancel") {
      await response.answerCallbackQuery();
      await showBotSettings(ctx, botId);
      return;
    }

    const newPrompt = response.message?.text?.trim();
    if (!newPrompt) {
      await ctx.reply("Please send a text message.", { reply_markup: cancelKb });
      continue;
    }

    await api.updateBot(botId, { systemPrompt: newPrompt });
    await ctx.reply("✅ Prompt updated!");
    await showBotSettings(ctx, botId);
    return;
  }
}

// --- Document upload conversation ---

async function uploadDocumentConversation(conversation: Conversation<MyContext, MyContext>, ctx: MyContext, botId: string) {
  if (!botId) {
    await ctx.editMessageText("No bot selected.", { reply_markup: menuKb });
    return;
  }

  const userId = String(ctx.from?.id ?? "");
  if (!userId) return;

  let tenantId: string;
  try {
    const tenant = await api.getOrCreateTenant(userId);
    tenantId = tenant.id;
  } catch {
    await ctx.editMessageText("Could not identify your account.", { reply_markup: menuKb });
    return;
  }

  async function showDocsList() {
    const docs = await api.listDocuments(tenantId);
    const kb = new InlineKeyboard();
    for (const d of docs) {
      const statusIcon = d.status === "ready" ? "✅" : d.status === "failed" ? "❌" : "⏳";
      kb.text(`${statusIcon} ${d.fileName.slice(0, 25)}`, `docitem_${d.id}`)
        .text("🗑️", `del_doc_${d.id}`).row();
    }
    kb.text("➕ Add Document", "add_doc").row();
    kb.text("🔙 Back", "doc_back");

    const text = docs.length === 0
      ? "No documents yet."
      : `📚 ${docs.length} document(s)`;

    await ctx.editMessageText(text, { reply_markup: kb });
  }

  async function confirmDelete(docId: string, fileName: string) {
    const confirmKb = new InlineKeyboard()
      .text("✅ Yes, delete", `confirm_del_${docId}`)
      .text("❌ No", "doc_cancel");
    await ctx.editMessageText(`Delete "${fileName}" and all its data?`, { reply_markup: confirmKb });
  }

  await showDocsList();

  while (true) {
    const response = await conversation.wait();

    if (response.callbackQuery?.data === "doc_back") {
      await response.answerCallbackQuery();
      await showBotSettings(response, botId);
      return;
    }

    if (response.callbackQuery?.data === "doc_cancel") {
      await response.answerCallbackQuery();
      await showDocsList();
      continue;
    }

    if (response.callbackQuery?.data === "add_doc") {
      await response.answerCallbackQuery();
      await ctx.editMessageText(
        "Send me a PDF file to add as knowledge for this bot.",
        { reply_markup: new InlineKeyboard().text("Cancel", "doc_cancel") },
      );
      continue;
    }

    const docMatch = response.callbackQuery?.data?.match(/^docitem_(.+)$/);
    if (docMatch) {
      await response.answerCallbackQuery({ text: "Tap 🗑️ to delete this document." });
      continue;
    }

    const delMatch = response.callbackQuery?.data?.match(/^del_doc_(.+)$/);
    if (delMatch) {
      await response.answerCallbackQuery();
      const docId = delMatch[1]!;
      const docs = await api.listDocuments(tenantId);
      const doc = docs.find(d => d.id === docId);
      await confirmDelete(docId, doc?.fileName ?? "unknown");
      continue;
    }

    const confirmDelMatch = response.callbackQuery?.data?.match(/^confirm_del_(.+)$/);
    if (confirmDelMatch) {
      await response.answerCallbackQuery();
      const docId = confirmDelMatch[1]!;
      try {
        await api.deleteDocument(docId);
        await ctx.reply("✅ Document deleted.");
      } catch (err) {
        await ctx.reply("❌ Failed to delete.");
      }
      await showDocsList();
      continue;
    }

    // Treat any message as a document upload attempt
    const doc = response.message?.document;
    if (!doc || !doc.mime_type?.startsWith("application/pdf")) {
      await ctx.reply("Please send a PDF file, or press Cancel.", {
        reply_markup: new InlineKeyboard().text("Cancel", "doc_cancel"),
      });
      continue;
    }

    // --- Process PDF (same logic as before) ---

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

      const botToken = process.env.BOT_TOKEN!;
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
}

// --- Bot creation ---

export async function createOnboardingBot(): Promise<Bot<BotContext>> {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is required");

  const bot = new Bot<BotContext>(token);

  bot.use(session({ initial: () => ({}) }));
  bot.use(conversations());
  bot.use(createConversation(createBotConversation, "createBot"));
  bot.use(createConversation(customizePromptConversation, "customizePrompt"));
  bot.use(createConversation(uploadDocumentConversation, "uploadDocument"));

  await bot.init();

  // --- Main menu ---

  bot.command("start", async (ctx) => {
    await ctx.reply("Main menu:", { reply_markup: menuKb });
    logger.debug({ userId: String(ctx.from?.id ?? "") }, "onboarding: /start");
  });

  // --- Create Bot ---

  bot.callbackQuery("create_bot", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("createBot");
  });

  // --- Manage ---

  bot.callbackQuery("manage", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = String(ctx.from!.id);
    const { kb, bots } = await botsListKb(userId);

    if (bots.length === 0) {
      await ctx.editMessageText("No bots yet. Create one below:", { reply_markup: kb });
    } else {
      await ctx.editMessageText("Your bots:", { reply_markup: kb });
    }
  });

  // --- Bot settings ---

  bot.callbackQuery(/^bot_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const botId = ctx.match![1]!;
    ctx.session.manageBotId = botId;
    await showBotSettings(ctx, botId);
  });

  // --- Pause / Resume ---

  bot.callbackQuery(/^pause_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const botId = ctx.match![1]!;
    ctx.session.manageBotId = botId;
    await api.updateBot(botId, { status: "paused" });
    await showBotSettings(ctx, botId);
  });

  bot.callbackQuery(/^resume_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const botId = ctx.match![1]!;
    ctx.session.manageBotId = botId;
    await api.updateBot(botId, { status: "active" });
    await showBotSettings(ctx, botId);
  });

  // --- Edit Prompt ---

  bot.callbackQuery("edit_prompt", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("customizePrompt");
  });

  // --- Delete ---

  bot.callbackQuery(/^delete_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const botId = ctx.match![1]!;

    const confirmKb = new InlineKeyboard()
      .text("✅ Yes, delete", `confirm_delete_${botId}`)
      .text("❌ No", `bot_${botId}`);

    await ctx.editMessageText(
      "⚠️ Are you sure? This permanently deletes the bot and all associated data.",
      { reply_markup: confirmKb }
    );
  });

  bot.callbackQuery(/^confirm_delete_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const botId = ctx.match![1]!;

    await api.deleteBot(botId);

    const userId = String(ctx.from!.id);
    const { kb, bots } = await botsListKb(userId);
    await ctx.editMessageText(
      bots.length === 0 ? "No bots left. Create one below:" : "✅ Bot deleted. Your bots:",
      { reply_markup: kb }
    );
  });

  // --- Documents per bot ---

  bot.callbackQuery(/^documents_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const botId = ctx.match![1]!;
    ctx.session.manageBotId = botId;
    await ctx.conversation.enter("uploadDocument", botId);
  });

  return bot;
}
