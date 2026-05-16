import { Bot, type Context, InlineKeyboard, session, type SessionFlavor } from "grammy";
import { type Conversation, type ConversationFlavor, conversations, createConversation } from "@grammyjs/conversations";
import { logger } from "../lib/logger";
import { createBot, updateBot, deleteBot, listBots } from "../lib/api";

type BaseCtx = Context & SessionFlavor<Record<string, never>>;
type OnCtx = BaseCtx & ConversationFlavor<BaseCtx>;

const menuKb = new InlineKeyboard()
  .text("🤖 Create Bot", "create_bot")
  .text("⚙️ Manage", "manage");

const cancelKb = new InlineKeyboard().text("Cancel", "cancel");

async function botsListKb(userId: string) {
  const bots = await listBots(userId);
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

async function showBotSettings(ctx: OnCtx, botId: string) {
  const bots = await listBots(String(ctx.from!.id));
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
  kb.text("🗑️ Delete", `delete_${botId}`).row();
  kb.text("🔙 Back", "manage");

  await ctx.editMessageText(
    `🤖 @${botRecord.botUsername}\nStatus: ${statusIcon}`,
    { reply_markup: kb }
  );
}

async function createBotConversation(conversation: Conversation<BaseCtx, BaseCtx>, ctx: BaseCtx) {
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

    const msg = response.message;
    if (msg) {
      await ctx.api.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    }

    let botUsername: string | null = null;
    try {
      // createBot writes a tenant_bots row (after a Telegram getMe), and
      // setWebhook below uses a fresh Bot instance whose API calls are NOT
      // memoized by the conversations plugin. Both must live inside
      // conversation.external so a later replay (e.g. the user pressing
      // anything that triggers another update) doesn't insert a duplicate
      // bot row and call setWebhook again.
      botUsername = await conversation.external(async () => {
        const userId = String(ctx.from!.id);
        const botRecord = await createBot(token, userId);
        logger.info({ botUsername: botRecord.botUsername, userId }, "onboarding: bot created");

        const publicUrl = process.env.PUBLIC_URL;
        if (publicUrl) {
          try {
            const merchantBot = new Bot(token);
            await merchantBot.api.setWebhook(
              `${publicUrl}/webhook/tenant/${botRecord.id}`,
              { drop_pending_updates: true, secret_token: botRecord.webhookSecret },
            );
            logger.info({ botId: botRecord.id, url: `${publicUrl}/webhook/tenant/${botRecord.id}` }, "tenant webhook set");
          } catch (err) {
            logger.error({ err, botId: botRecord.id }, "failed to set tenant webhook");
          }
        }

        return botRecord.botUsername;
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      if (errMsg.includes("Invalid")) {
        await ctx.reply("Invalid token. Try again.", { reply_markup: cancelKb });
        continue;
      }
      await ctx.reply(errMsg, { reply_markup: menuKb });
      return;
    }

    await ctx.reply(`✅ Bot @${botUsername} connected!`, { reply_markup: menuKb });
    return;
  }
}

export async function createOnboardingBot(): Promise<Bot> {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is required");

  const bot = new Bot<OnCtx>(token);

  bot.use(session({ initial: () => ({}) }));
  bot.use(conversations());
  bot.use(createConversation(createBotConversation, "createBot"));

  await bot.init();

  bot.command("start", async (ctx) => {
    await ctx.reply("Main menu:", { reply_markup: menuKb });
    logger.debug({ userId: String(ctx.from?.id ?? "") }, "onboarding: /start");
  });

  bot.callbackQuery("create_bot", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("createBot");
  });

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

  bot.callbackQuery(/^bot_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const botId = ctx.match![1]!;
    await showBotSettings(ctx, botId);
  });

  bot.callbackQuery(/^pause_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const botId = ctx.match![1]!;
    await updateBot(botId, { status: "paused" });
    await showBotSettings(ctx, botId);
  });

  bot.callbackQuery(/^resume_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const botId = ctx.match![1]!;
    await updateBot(botId, { status: "active" });
    await showBotSettings(ctx, botId);
  });

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
    await deleteBot(botId);

    const userId = String(ctx.from!.id);
    const { kb, bots } = await botsListKb(userId);
    await ctx.editMessageText(
      bots.length === 0 ? "No bots left. Create one below:" : "✅ Bot deleted. Your bots:",
      { reply_markup: kb }
    );
  });

  bot.callbackQuery("menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Main menu:", { reply_markup: menuKb });
  });

  return bot as unknown as Bot;
}
