import { Bot, type Context, session, InlineKeyboard, type SessionFlavor } from "grammy";
import { type Conversation, type ConversationFlavor, conversations, createConversation } from "@grammyjs/conversations";
import { api } from "../api/client";

type MyContext = Context & SessionFlavor<{ manageBotId?: string }> & ConversationFlavor;

const menuKb = new InlineKeyboard()
  .text("🤖 Create Bot", "create_bot")
  .text("⚙️ Manage", "manage")
  .row()
  .text("📄 Documents", "documents");

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

async function createBotConversation(conversation: Conversation<MyContext>, ctx: MyContext) {
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

async function customizePromptConversation(conversation: Conversation<MyContext>, ctx: MyContext) {
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

// --- Bot creation ---

export async function createOnboardingBot(): Promise<Bot<MyContext>> {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is required");

  const bot = new Bot<MyContext>(token);

  bot.use(session({ initial: () => ({}) }));
  bot.use(conversations());
  bot.use(createConversation(createBotConversation, "createBot"));
  bot.use(createConversation(customizePromptConversation, "customizePrompt"));

  await bot.init();

  // --- Main menu ---

  bot.command("start", async (ctx) => {
    await ctx.reply("Main menu:", { reply_markup: menuKb });
  });

  bot.callbackQuery("menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Main menu:", { reply_markup: menuKb });
  });

  bot.callbackQuery("cancel", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Main menu:", { reply_markup: menuKb });
  });

  bot.on("message:text", async (ctx) => {
    await ctx.reply("Use /start for the menu.", { reply_markup: menuKb });
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

  // --- Documents placeholder ---

  bot.callbackQuery("documents", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Coming soon!" });
  });

  return bot;
}
