import { Bot, type Context, InlineKeyboard, session, type SessionFlavor } from "grammy";
import { type Conversation, type ConversationFlavor, conversations, createConversation } from "@grammyjs/conversations";
import { limit } from "@grammyjs/ratelimiter";
import { logger } from "../lib/logger";
import { createBot, updateBot, deleteBot, listBots } from "../lib/api";
import { sequentializeByChat } from "../lib/sequentialize";
import { UpstashSessionStorage } from "../lib/session-storage";

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
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply("Bot not found.", { reply_markup: menuKb });
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

  await ctx.deleteMessage().catch(() => {});
  await ctx.reply(
    `🤖 @${botRecord.botUsername}\nStatus: ${statusIcon}`,
    { reply_markup: kb },
  );
}

const DELETE_CONFIRM_PHRASE = "Yes, I am totally sure.";

async function deleteBotConversation(
  conversation: Conversation<BaseCtx, BaseCtx>,
  ctx: BaseCtx,
  botId: string,
) {
  const chatId = ctx.chat!.id;
  let screenMsgId: number | null = ctx.callbackQuery?.message?.message_id ?? null;

  if (screenMsgId !== null) {
    await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
  }
  let sent = await ctx.reply(
    "⚠️ This permanently deletes the bot and all associated data.\n\n" +
      `To confirm, reply with exactly:\n\n<code>${DELETE_CONFIRM_PHRASE}</code>\n\n` +
      "Or press Cancel.",
    { reply_markup: cancelKb, parse_mode: "HTML" },
  );
  screenMsgId = sent.message_id;

  while (true) {
    const response = await conversation.wait();

    if (response.callbackQuery?.data === "cancel") {
      await response.answerCallbackQuery();
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        screenMsgId = null;
      }
      const userId = String(ctx.from!.id);
      const { kb, bots } = await conversation.external(() => botsListKb(userId));
      await response.reply(
        bots.length === 0 ? "No bots yet. Create one below:" : "Your bots:",
        { reply_markup: kb },
      );
      return;
    }

    if (response.callbackQuery) {
      await response.answerCallbackQuery({ text: "Callback query old" });
      await response.deleteMessage().catch(() => {});
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        screenMsgId = null;
      }
      await response.reply("Main menu:", { reply_markup: menuKb });
      return;
    }

    const text = response.message?.text?.trim();
    const msg = response.message;
    if (msg) {
      await ctx.api.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    }

    if (text !== DELETE_CONFIRM_PHRASE) {
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
      }
      sent = await ctx.reply(
        "❌ That doesn't match. Reply with exactly:\n\n" +
          `<code>${DELETE_CONFIRM_PHRASE}</code>\n\nOr press Cancel.`,
        { reply_markup: cancelKb, parse_mode: "HTML" },
      );
      screenMsgId = sent.message_id;
      continue;
    }

    try {
      await conversation.external(() => deleteBot(botId));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        screenMsgId = null;
      }
      await ctx.reply(`Delete failed: ${errMsg}`, { reply_markup: menuKb });
      return;
    }

    const userId = String(ctx.from!.id);
    const { kb, bots } = await conversation.external(() => botsListKb(userId));
    if (screenMsgId !== null) {
      await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
      screenMsgId = null;
    }
    await ctx.reply(
      bots.length === 0 ? "No bots left. Create one below:" : "✅ Bot deleted. Your bots:",
      { reply_markup: kb },
    );
    return;
  }
}

async function createBotConversation(conversation: Conversation<BaseCtx, BaseCtx>, ctx: BaseCtx) {
  const chatId = ctx.chat!.id;
  // The "screen" is the most recently sent menu/prompt message. We track its
  // id by hand so subsequent updates can delete + re-send instead of editing
  // (which would leave the message stranded above any progress messages).
  let screenMsgId: number | null = ctx.callbackQuery?.message?.message_id ?? null;

  if (screenMsgId !== null) {
    await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
  }
  let sent = await ctx.reply(
    "Send me your bot token.\n\n" +
    "1. Create a bot via @BotFather\n" +
    "2. Enable Business Mode in BotFather settings\n" +
    "3. Paste the token here",
    { reply_markup: cancelKb },
  );
  screenMsgId = sent.message_id;

  while (true) {
    const response = await conversation.wait();

    if (response.callbackQuery?.data === "cancel") {
      await response.answerCallbackQuery();
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        screenMsgId = null;
      }
      await response.reply("Main menu:", { reply_markup: menuKb });
      return;
    }

    if (response.callbackQuery) {
      // Stale button from an older state. Exit cleanly to the main menu.
      await response.answerCallbackQuery({ text: "Callback query old" });
      await response.deleteMessage().catch(() => {});
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        screenMsgId = null;
      }
      await response.reply("Main menu:", { reply_markup: menuKb });
      return;
    }

    const token = response.message?.text?.trim();
    if (!token) {
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
      }
      sent = await ctx.reply(
        "Please send a valid bot token, or press Cancel.",
        { reply_markup: cancelKb },
      );
      screenMsgId = sent.message_id;
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
        if (screenMsgId !== null) {
          await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        }
        sent = await ctx.reply(
          "Invalid token. Send me a valid bot token, or press Cancel.",
          { reply_markup: cancelKb },
        );
        screenMsgId = sent.message_id;
        continue;
      }
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        screenMsgId = null;
      }
      await ctx.reply(errMsg, { reply_markup: menuKb });
      return;
    }

    if (screenMsgId !== null) {
      await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
      screenMsgId = null;
    }
    await ctx.reply(
      `✅ Bot @${botUsername} connected!\n\n` +
        "Next: open Telegram → Settings → Business → Chatbots, " +
        `add @${botUsername}, and grant at least these permissions:\n` +
        "• Reply to messages (required)\n" +
        "• Read messages (recommended)",
      { reply_markup: menuKb },
    );
    return;
  }
}

export async function createOnboardingBot(): Promise<Bot> {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is required");

  const bot = new Bot<OnCtx>(token);

  // Per-user rate limit on every interaction. 20 updates / 60 s is plenty
  // for a real human poking through the menu and well under what a
  // button-mashing or scripted client would generate. Must run before
  // sequentialize/session/conversations so dropped updates don't waste
  // queue slots or DB lookups. Silent drop — no reply to the abuser.
  bot.use(
    limit({
      timeFrame: 60_000,
      limit: 20,
      keyGenerator: (ctx) => ctx.from?.id.toString(),
      keyPrefix: "onboarding:",
    }),
  );
  // Must come before session/conversations so updates from the same chat
  // never race on the conversations plugin's per-chat replay log.
  bot.use(sequentializeByChat());
  bot.use(
    session({
      initial: () => ({}),
      // Conversation replay log persists across restarts — no more "Bad
      // replay" errors after a redeploy mid-conversation, and ready for
      // horizontal scaling whenever we get there.
      storage: new UpstashSessionStorage("tg:session:onboarding:"),
    }),
  );
  // The conversations plugin manages its own per-chat state separately
  // from the session middleware above — without an explicit `storage`
  // option it defaults to in-memory, which means conversation state is
  // lost on every restart even though session() persists. Wire its
  // storage explicitly to Upstash so conversations survive restarts.
  bot.use(
    conversations({
      storage: {
        type: "key",
        adapter: new UpstashSessionStorage("tg:conv:onboarding:"),
      },
    }),
  );
  bot.use(createConversation(createBotConversation, "createBot"));
  bot.use(createConversation(deleteBotConversation, "deleteBot"));

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

    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(
      bots.length === 0 ? "No bots yet. Create one below:" : "Your bots:",
      { reply_markup: kb },
    );
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
    await ctx.conversation.enter("deleteBot", botId);
  });

  bot.callbackQuery("menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply("Main menu:", { reply_markup: menuKb });
  });

  // Catch-all for callbacks that no specific handler matched — buttons left
  // over after a process restart, or stale buttons whose state is gone.
  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Callback query old" }).catch(() => {});
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply("Main menu:", { reply_markup: menuKb });
  });

  return bot as unknown as Bot;
}
