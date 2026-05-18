import { Bot, type Context, InlineKeyboard, session, type SessionFlavor } from "grammy";
import { type Conversation, type ConversationFlavor, conversations, createConversation } from "@grammyjs/conversations";
import { limit } from "@grammyjs/ratelimiter";
import { logger } from "../lib/logger";
import { createBot, updateBot, deleteBot, listBots } from "../lib/api";
import { sequentializeByChat } from "../lib/sequentialize";
import { ownerCaptureMiddleware } from "../lib/owner-capture";
import { attachBillingHandlers, buildBillingMenuButton } from "./billing";
import { attachAdminCommands } from "./admin-commands";
import {
  checkQuota,
  decrementBotCount,
  incrementBotCount,
  startTrialOnFirstBot,
} from "../lib/owners";
import { UpstashSessionStorage } from "../lib/session-storage";
import {
  BOT_NOT_FOUND,
  DELETE_CONFIRM_PHRASE,
  MAIN_MENU_TITLE,
  ONBOARDING_BOT_LIST_AFTER_DELETE_EMPTY,
  ONBOARDING_BOT_LIST_AFTER_DELETE_HEADER,
  ONBOARDING_BOT_LIST_EMPTY,
  ONBOARDING_BOT_LIST_HEADER,
  ONBOARDING_CREATE_PROMPT,
  ONBOARDING_HELP,
  ONBOARDING_INVALID_TOKEN,
  ONBOARDING_TOKEN_REQUIRED,
  SUBSCRIBE_TO_CREATE_BOT,
  TOAST_STALE_CALLBACK,
  botCreateBlocked,
  deleteBotMismatch,
  deleteBotPrompt,
  onboardingBotConnected,
  onboardingBotStatusLine,
  onboardingDeleteFailed,
  onboardingWelcome,
} from "../lib/text";

type BaseCtx = Context & SessionFlavor<Record<string, never>>;
type OnCtx = BaseCtx & ConversationFlavor<BaseCtx>;

// Static fallback used inside conversations (which need an instantly-
// available keyboard for stale-callback recovery). The /start path uses
// `buildMainMenuKb` so the billing button reflects current owner state.
const menuKb = new InlineKeyboard()
  .text("🤖 New bot", "create_bot")
  .text("⚙️ Your bots", "manage");

async function buildMainMenuKb(userId: string): Promise<InlineKeyboard> {
  const billing = await buildBillingMenuButton(userId);
  return new InlineKeyboard()
    .text("🤖 New bot", "create_bot")
    .text("⚙️ Your bots", "manage")
    .row()
    .text(billing.label, billing.callbackData);
}

const cancelKb = new InlineKeyboard().text("Cancel", "cancel");

async function botsListKb(userId: string) {
  const bots = await listBots(userId);
  const kb = new InlineKeyboard();
  for (const b of bots) {
    const label = b.botUsername ? `@${b.botUsername}` : b.id.slice(0, 8);
    const statusIcon = b.status === "active" ? "✅" : "⏸";
    kb.text(`${statusIcon} ${label}`, `bot_${b.id}`).row();
  }
  kb.text("🤖 New bot", "create_bot").row();
  kb.text("⬅ Back", "menu");
  return { kb, bots };
}

async function showBotSettings(ctx: OnCtx, botId: string) {
  const bots = await listBots(String(ctx.from!.id));
  const botRecord = bots.find(b => b.id === botId);
  if (!botRecord) {
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(BOT_NOT_FOUND, { reply_markup: menuKb });
    return;
  }

  const statusIcon = botRecord.status === "active" ? "✅ Active" : "⏸ Paused";
  const kb = new InlineKeyboard();

  if (botRecord.status === "active") {
    kb.text("⏸ Pause", `pause_${botId}`);
  } else {
    kb.text("▶ Resume", `resume_${botId}`);
  }
  kb.row();
  kb.text("⬅ Back to bots", "manage").row();
  kb.text("⚠ Delete bot", `delete_${botId}`);

  await ctx.deleteMessage().catch(() => {});
  await ctx.reply(
    onboardingBotStatusLine(botRecord.botUsername ?? "", statusIcon),
    { reply_markup: kb },
  );
}

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
    deleteBotPrompt(DELETE_CONFIRM_PHRASE),
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
        bots.length === 0
          ? ONBOARDING_BOT_LIST_EMPTY
          : ONBOARDING_BOT_LIST_HEADER,
        { reply_markup: kb },
      );
      return;
    }

    if (response.callbackQuery) {
      await response.answerCallbackQuery({ text: TOAST_STALE_CALLBACK });
      await response.deleteMessage().catch(() => {});
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        screenMsgId = null;
      }
      await response.reply(MAIN_MENU_TITLE, { reply_markup: menuKb });
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
        deleteBotMismatch(DELETE_CONFIRM_PHRASE),
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
      await ctx.reply(onboardingDeleteFailed(errMsg), { reply_markup: menuKb });
      return;
    }

    // Decrement the per-owner counter on a successful delete. Fail-open in
    // owners.ts — weekly reconcile cron catches any drift.
    await conversation.external(() =>
      decrementBotCount(String(ctx.from!.id)),
    );

    const userId = String(ctx.from!.id);
    const { kb, bots } = await conversation.external(() => botsListKb(userId));
    if (screenMsgId !== null) {
      await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
      screenMsgId = null;
    }
    await ctx.reply(
      bots.length === 0
        ? ONBOARDING_BOT_LIST_AFTER_DELETE_EMPTY
        : ONBOARDING_BOT_LIST_AFTER_DELETE_HEADER,
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
  let sent = await ctx.reply(ONBOARDING_CREATE_PROMPT, {
    reply_markup: cancelKb,
  });
  screenMsgId = sent.message_id;

  while (true) {
    const response = await conversation.wait();

    if (response.callbackQuery?.data === "cancel") {
      await response.answerCallbackQuery();
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        screenMsgId = null;
      }
      await response.reply(MAIN_MENU_TITLE, { reply_markup: menuKb });
      return;
    }

    if (response.callbackQuery) {
      // Stale button from an older state. Exit cleanly to the main menu.
      await response.answerCallbackQuery({ text: TOAST_STALE_CALLBACK });
      await response.deleteMessage().catch(() => {});
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        screenMsgId = null;
      }
      await response.reply(MAIN_MENU_TITLE, { reply_markup: menuKb });
      return;
    }

    const token = response.message?.text?.trim();
    if (!token) {
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
      }
      sent = await ctx.reply(ONBOARDING_TOKEN_REQUIRED, {
        reply_markup: cancelKb,
      });
      screenMsgId = sent.message_id;
      continue;
    }

    const msg = response.message;
    if (msg) {
      await ctx.api.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    }

    // Note: the bot-creation quota gate runs at button-tap time
    // (`create_bot` callback handler below), not here. Re-checking after
    // the owner has already pasted a token would burn the round-trip,
    // and an owner can't subscribe inside the conversation anyway.

    const ownerTelegramId = String(ctx.from!.id);
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
        sent = await ctx.reply(ONBOARDING_INVALID_TOKEN, {
          reply_markup: cancelKb,
        });
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

    // Successful bot creation. Bump the per-owner denormalized counter
    // and (idempotently) start the trial clock on the owner's first bot.
    // Both are fail-open inside owners.ts; counter drift is reconciled by
    // cron/usage.reconcile and startTrialOnFirstBot is a no-op when
    // trial_ends_at is already set.
    await conversation.external(() => incrementBotCount(ownerTelegramId));
    await conversation.external(() => startTrialOnFirstBot(ownerTelegramId));

    if (screenMsgId !== null) {
      await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
      screenMsgId = null;
    }
    await ctx.reply(onboardingBotConnected(botUsername ?? ""), {
      reply_markup: menuKb,
    });
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
  // Opportunistic owner-profile upsert. Runs after rate-limit (so we
  // don't bother upserting profiles for abusers we're dropping) and
  // before sequentialize/session/conversations (the upsert is fire-and-
  // forget, so it doesn't matter where in the chain it sits relative to
  // those — but earlier is fine and keeps the intent obvious).
  bot.use(ownerCaptureMiddleware());
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

  // Mount admin commands + billing surface BEFORE the catch-all callback
  // handler at the bottom — otherwise the catch-all swallows /billing
  // callbacks.
  // Bot<OnCtx> is invariant in Context; the attach helpers only use the
  // base Context surface (callbacks, command, on(...)) so the cast is safe.
  attachAdminCommands(bot as unknown as Bot<Context>);
  attachBillingHandlers(bot as unknown as Bot<Context>);

  await bot.init();

  bot.command("start", async (ctx) => {
    const userId = String(ctx.from?.id ?? "");
    const kb = userId ? await buildMainMenuKb(userId) : menuKb;
    await ctx.reply(onboardingWelcome(ctx.from?.first_name ?? null), {
      reply_markup: kb,
      parse_mode: "HTML",
    });
    logger.debug({ userId }, "onboarding: /start");
  });

  bot.command("help", async (ctx) => {
    const userId = String(ctx.from?.id ?? "");
    const kb = userId ? await buildMainMenuKb(userId) : menuKb;
    await ctx.reply(ONBOARDING_HELP, {
      reply_markup: kb,
      parse_mode: "HTML",
    });
    logger.debug({ userId }, "onboarding: /help");
  });

  bot.callbackQuery("create_bot", async (ctx) => {
    // Plan-cap quota gate. Runs at button-tap so the owner sees the
    // subscribe / upgrade CTA before they're prompted for a bot token.
    // Lapsed/banned owners get the subscribe wall; at-cap owners on a
    // paid plan get the plan-aware blocked message.
    const ownerTelegramId = String(ctx.from?.id ?? "");
    if (ownerTelegramId) {
      const quota = await checkQuota(ownerTelegramId, "bot");
      if (!quota.ok) {
        await ctx.answerCallbackQuery();
        const message =
          quota.reason === "lapsed" || quota.reason === "banned"
            ? SUBSCRIBE_TO_CREATE_BOT
            : botCreateBlocked({
                cap: quota.limit,
                planLabel: quota.plan ?? "",
              });
        const kb = await buildMainMenuKb(ownerTelegramId);
        await ctx.deleteMessage().catch(() => {});
        await ctx.reply(message, { reply_markup: kb, parse_mode: "HTML" });
        return;
      }
    }
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("createBot");
  });

  bot.callbackQuery("manage", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = String(ctx.from!.id);
    const { kb, bots } = await botsListKb(userId);

    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(
      bots.length === 0
        ? ONBOARDING_BOT_LIST_EMPTY
        : ONBOARDING_BOT_LIST_HEADER,
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
    const userId = String(ctx.from?.id ?? "");
    const kb = userId ? await buildMainMenuKb(userId) : menuKb;
    await ctx.reply(MAIN_MENU_TITLE, { reply_markup: kb });
  });

  // Catch-all for callbacks that no specific handler matched — buttons left
  // over after a process restart, or stale buttons whose state is gone.
  bot.on("callback_query:data", async (ctx) => {
    await ctx
      .answerCallbackQuery({ text: TOAST_STALE_CALLBACK })
      .catch(() => {});
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(MAIN_MENU_TITLE, { reply_markup: menuKb });
  });

  return bot as unknown as Bot;
}
