import { Bot, type Api, type Context, InlineKeyboard, session, type SessionFlavor } from "grammy";
import { type Conversation, type ConversationFlavor, conversations, createConversation } from "@grammyjs/conversations";
import { limit } from "@grammyjs/ratelimiter";
import { logger } from "../lib/logger";
import { createBot, updateBot, deleteBot, restartBot, listBots } from "../lib/api";
import { sequentializeByChat } from "../lib/sequentialize";
import { ownerCaptureMiddleware } from "../lib/owner-capture";
import {
  attachBillingHandlers,
  buildBillingMenuButton,
  renderBillingScreen,
} from "./billing";
import { attachAdminCommands } from "./admin-commands";
import { registry } from "./registry";
import { ownerDistinctId, track } from "../lib/analytics";
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
  PRIVACY_POLICY,
  TERMS_OF_SERVICE,
  ONBOARDING_INVALID_TOKEN,
  ONBOARDING_TOKEN_REQUIRED,
  SUBSCRIBE_TO_CREATE_BOT,
  botCreateBlocked,
  deleteBotMismatch,
  deleteBotPrompt,
  onboardingBotConnected,
  onboardingBotStatusLine,
  onboardingDeleteFailed,
  onboardingWelcome,
  restartErrorMessage,
  ADMIN_UNAUTHORIZED,
  ADMIN_DASHBOARD_PROMPT,
  ADMIN_DASHBOARD_BUTTON,
  ADMIN_DASHBOARD_UNAVAILABLE,
  BROADCAST_PROMPT,
  BROADCAST_NEED_MESSAGE,
  BROADCAST_CANCELLED,
  BROADCAST_NO_AUDIENCE,
  BROADCAST_SENDING,
  broadcastConfirm,
  broadcastDone,
} from "../lib/text";
import { isAdmin } from "./admin-commands";
import {
  broadcastAudienceSize,
  runBroadcast,
} from "../lib/broadcast";

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
    await ctx.reply(BOT_NOT_FOUND, {
      reply_markup: await buildMainMenuKb(String(ctx.from!.id)),
    });
    return;
  }

  const statusIcon = botRecord.status === "active" ? "✅ Active" : "⏸ Paused";
  const kb = new InlineKeyboard();

  if (botRecord.status === "active") {
    kb.text("⏸ Pause", `pause_${botId}`);
  } else {
    kb.text("▶ Resume", `resume_${botId}`);
  }
  // Restart re-validates the token + re-sets the webhook to recover a bot
  // that stopped receiving updates, without losing its config/docs.
  kb.text("🔄 Restart", `restart_${botId}`);
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
      await response.answerCallbackQuery();
      await response.deleteMessage().catch(() => {});
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        screenMsgId = null;
      }
      await response.reply(MAIN_MENU_TITLE, {
        reply_markup: await buildMainMenuKb(String(ctx.from!.id)),
      });
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
      const ownerIdMismatch = String(ctx.from?.id ?? "");
      if (ownerIdMismatch) {
        track(
          ownerDistinctId(ownerIdMismatch),
          "onboarding.bot.delete.mismatch",
          {},
          { bot: botId },
        );
      }
      continue;
    }

    try {
      await conversation.external(() => deleteBot(botId));
      // Evict from the registry cache so webhook attempts after delete
      // short-circuit at registry.get instead of serving handlers from
      // a now-orphaned entry. Safe to run inside conversation.external —
      // it's synchronous and idempotent.
      await conversation.external(() => {
        registry.invalidate(botId);
      });
      const ownerIdDel = String(ctx.from?.id ?? "");
      if (ownerIdDel) {
        track(
          ownerDistinctId(ownerIdDel),
          "onboarding.bot.delete.confirmed",
          {},
          { bot: botId },
        );
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        screenMsgId = null;
      }
      await ctx.reply(onboardingDeleteFailed(errMsg), {
        reply_markup: await buildMainMenuKb(String(ctx.from!.id)),
      });
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
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
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
      await response.reply(MAIN_MENU_TITLE, {
        reply_markup: await buildMainMenuKb(String(ctx.from!.id)),
      });
      return;
    }

    if (response.callbackQuery) {
      // Stale button from an older state. Exit cleanly to the main menu.
      await response.answerCallbackQuery();
      await response.deleteMessage().catch(() => {});
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        screenMsgId = null;
      }
      await response.reply(MAIN_MENU_TITLE, {
        reply_markup: await buildMainMenuKb(String(ctx.from!.id)),
      });
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

    {
      const submittingId = String(ctx.from?.id ?? "");
      if (submittingId) {
        track(
          ownerDistinctId(submittingId),
          "onboarding.bot.create.token_submitted",
        );
      }
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
      track(
        ownerDistinctId(ownerTelegramId),
        "onboarding.bot.create.token_invalid",
        { errMsg: errMsg.slice(0, 200) },
      );
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
      await ctx.reply(errMsg, {
        reply_markup: await buildMainMenuKb(String(ctx.from!.id)),
      });
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
      reply_markup: await buildMainMenuKb(ownerTelegramId),
    });
    track(
      ownerDistinctId(ownerTelegramId),
      "onboarding.bot.create.succeeded",
      { botUsername: botUsername ?? null },
    );
    return;
  }
}

/**
 * Admin-only broadcast conversation. Prompts for a message (any type),
 * confirms the audience size, then copies it to every non-banned user.
 * The send loop runs inside `conversation.external` so a replay never
 * re-broadcasts. `api` is captured so the loop can run outside the
 * replay-tracked ctx.
 */
function makeBroadcastConversation(api: Api) {
  return async function broadcastConversation(
    conversation: Conversation<BaseCtx, BaseCtx>,
    ctx: BaseCtx,
  ): Promise<void> {
    await ctx.reply(BROADCAST_PROMPT, { reply_markup: cancelKb });

    // Wait for the message to broadcast (or Cancel).
    let fromChatId: number;
    let messageId: number;
    while (true) {
      const response = await conversation.wait();
      if (response.callbackQuery?.data === "cancel") {
        await response.answerCallbackQuery();
        await ctx.reply(BROADCAST_CANCELLED);
        return;
      }
      if (response.callbackQuery) {
        await response.answerCallbackQuery();
        continue;
      }
      const msg = response.message;
      if (!msg) {
        await ctx.reply(BROADCAST_NEED_MESSAGE, { reply_markup: cancelKb });
        continue;
      }
      fromChatId = msg.chat.id;
      messageId = msg.message_id;
      break;
    }

    // Confirm — mass send is irreversible.
    const count = await conversation.external(() => broadcastAudienceSize());
    if (count === 0) {
      await ctx.reply(BROADCAST_NO_AUDIENCE);
      return;
    }
    const confirmKb = new InlineKeyboard()
      .text("Cancel", "cancel")
      .text("📣 Send", "broadcast_send");
    await ctx.reply(broadcastConfirm(count), { reply_markup: confirmKb });

    const confirm = await conversation.wait();
    if (confirm.callbackQuery?.data !== "broadcast_send") {
      if (confirm.callbackQuery) {
        await confirm.answerCallbackQuery().catch(() => {});
        // Remove the confirm message (with its buttons) on cancel too.
        await confirm.deleteMessage().catch(() => {});
      }
      await ctx.reply(BROADCAST_CANCELLED);
      return;
    }
    await confirm.answerCallbackQuery();
    // Delete the confirm prompt (the message the admin pressed Send on)
    // so the inline buttons don't linger in the chat.
    await confirm.deleteMessage().catch(() => {});

    await ctx.reply(BROADCAST_SENDING);
    const result = await conversation.external(() =>
      runBroadcast(api, fromChatId, messageId),
    );
    await ctx.reply(broadcastDone(result));
  };
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
  bot.use(createConversation(makeBroadcastConversation(bot.api), "broadcast"));

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
    // Deep-link payload: the Mini App's billing "Manage" button opens
    // `?start=billing`, which lands here. Render the billing screen
    // directly instead of the welcome.
    if (userId && ctx.match === "billing") {
      track(ownerDistinctId(userId), "onboarding.start.billing_deeplink");
      await renderBillingScreen(ctx as unknown as Context, userId);
      return;
    }
    const kb = userId ? await buildMainMenuKb(userId) : menuKb;
    await ctx.reply(onboardingWelcome(ctx.from?.first_name ?? null), {
      reply_markup: kb,
      parse_mode: "HTML",
    });
    logger.debug({ userId }, "onboarding: /start");
    if (userId) track(ownerDistinctId(userId), "onboarding.start.opened");
  });

  bot.command("broadcast", async (ctx) => {
    if (!isAdmin(ctx as unknown as Context)) {
      await ctx.reply(ADMIN_UNAUTHORIZED);
      return;
    }
    track(ownerDistinctId(String(ctx.from?.id ?? "")), "admin.broadcast.started");
    await ctx.conversation.enter("broadcast");
  });

  // Admin-only Mini App opener. Unlisted (kept out of setMyCommands) so
  // regular owners never see it. Opens the Mini App directly at /admin via a
  // `web_app` inline button. A `?startapp=` deep link would require a
  // BotFather-registered *Main* Mini App (which this bot has none of — hence
  // "this application doesn't exist"); an inline web_app button only needs the
  // HTTPS URL, works in this private chat, and still delivers signed initData,
  // so the GET /api/admin/* routes re-verify the admin id server-side (the URL
  // alone grants nothing). Reuses the same isAdmin gate as /broadcast so a
  // non-admin who somehow opens it still hits a flat 403.
  bot.command("dashboard", async (ctx) => {
    if (!isAdmin(ctx as unknown as Context)) {
      await ctx.reply(ADMIN_UNAUTHORIZED);
      return;
    }
    const userId = String(ctx.from?.id ?? "");
    const miniappOrigin = process.env.MINIAPP_ORIGIN;
    if (!miniappOrigin) {
      await ctx.reply(ADMIN_DASHBOARD_UNAVAILABLE);
      return;
    }
    const kb = new InlineKeyboard().webApp(
      ADMIN_DASHBOARD_BUTTON,
      `${miniappOrigin.replace(/\/$/, "")}/admin`,
    );
    await ctx.reply(ADMIN_DASHBOARD_PROMPT, { reply_markup: kb });
    track(ownerDistinctId(userId), "admin.dashboard.opened");
  });

  bot.command("help", async (ctx) => {
    const userId = String(ctx.from?.id ?? "");
    const kb = userId ? await buildMainMenuKb(userId) : menuKb;
    await ctx.reply(ONBOARDING_HELP, {
      reply_markup: kb,
      parse_mode: "HTML",
    });
    logger.debug({ userId }, "onboarding: /help");
    if (userId) track(ownerDistinctId(userId), "onboarding.help.opened");
  });

  bot.command("privacy", async (ctx) => {
    await ctx.reply(PRIVACY_POLICY, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    const userId = String(ctx.from?.id ?? "");
    if (userId) track(ownerDistinctId(userId), "onboarding.privacy.opened");
  });

  bot.command("terms", async (ctx) => {
    await ctx.reply(TERMS_OF_SERVICE, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    const userId = String(ctx.from?.id ?? "");
    if (userId) track(ownerDistinctId(userId), "onboarding.terms.opened");
  });

  // Register the slash-menu autocomplete globally. Owners typing `/`
  // see the five commands with descriptions. Fire-and-forget — a
  // transient Telegram error here doesn't matter, the menu will
  // re-register on the next deploy.
  bot.api
    .setMyCommands([
      { command: "start", description: "Main menu" },
      { command: "help", description: "Show help" },
      { command: "billing", description: "Plan and billing" },
      { command: "privacy", description: "Privacy policy" },
      { command: "terms", description: "Terms of service" },
    ])
    .catch((err) => {
      logger.warn({ err }, "onboarding setMyCommands failed");
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
        track(ownerDistinctId(ownerTelegramId), "onboarding.bot.create.blocked", {
          reason: quota.reason ?? "unknown",
        });
        return;
      }
    }
    await ctx.answerCallbackQuery();
    if (ownerTelegramId) {
      track(
        ownerDistinctId(ownerTelegramId),
        "onboarding.bot.create.prompt_shown",
      );
    }
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
    const ownerId = String(ctx.from?.id ?? "");
    if (ownerId) {
      track(
        ownerDistinctId(ownerId),
        "onboarding.bot.opened",
        {},
        { bot: botId },
      );
    }
    await showBotSettings(ctx, botId);
  });

  bot.callbackQuery(/^pause_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const botId = ctx.match![1]!;
    await updateBot(botId, { status: "paused" });
    // Evict from registry so the next webhook re-reads status and
    // returns "Bot not active". Without this the cached entry would
    // keep serving webhooks despite the DB status flip.
    registry.invalidate(botId);
    const ownerId = String(ctx.from?.id ?? "");
    if (ownerId) {
      track(
        ownerDistinctId(ownerId),
        "onboarding.bot.pause.toggled",
        { newStatus: "paused" },
        { bot: botId },
      );
    }
    await showBotSettings(ctx, botId);
  });

  bot.callbackQuery(/^resume_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const botId = ctx.match![1]!;
    await updateBot(botId, { status: "active" });
    // Force a fresh load so any state that changed while paused (e.g.
    // welcome message tweaks via the API) is picked up cleanly.
    registry.invalidate(botId);
    const ownerId = String(ctx.from?.id ?? "");
    if (ownerId) {
      track(
        ownerDistinctId(ownerId),
        "onboarding.bot.resume.toggled",
        {},
        { bot: botId },
      );
    }
    await showBotSettings(ctx, botId);
  });

  bot.callbackQuery(/^restart_(.+)$/, async (ctx) => {
    // Answer immediately to dismiss the button spinner — restartBot makes two
    // Telegram round-trips (getMe + setWebhook) and can take a beat.
    await ctx.answerCallbackQuery();
    const botId = ctx.match![1]!;
    const ownerId = String(ctx.from?.id ?? "");

    const outcome = await restartBot(botId);
    // Re-read on the next webhook so the refreshed status/username take
    // effect (mirrors pause/resume).
    registry.invalidate(botId);

    if (ownerId) {
      track(
        ownerDistinctId(ownerId),
        outcome.ok
          ? "onboarding.bot.restart.ok"
          : "onboarding.bot.restart.failed",
        outcome.ok ? {} : { reason: outcome.reason },
        { bot: botId },
      );
    }

    // On success the refreshed settings screen (now "✅ Active") is the
    // feedback; on failure post an actionable line before re-rendering.
    if (!outcome.ok) {
      await ctx.reply(restartErrorMessage(outcome.reason));
    }
    await showBotSettings(ctx, botId);
  });

  bot.callbackQuery(/^delete_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const botId = ctx.match![1]!;
    const ownerId = String(ctx.from?.id ?? "");
    if (ownerId) {
      track(
        ownerDistinctId(ownerId),
        "onboarding.bot.delete.prompt_shown",
        {},
        { bot: botId },
      );
    }
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
      .answerCallbackQuery()
      .catch(() => {});
    await ctx.deleteMessage().catch(() => {});
    const userId = String(ctx.from?.id ?? "");
    const kb = userId ? await buildMainMenuKb(userId) : menuKb;
    await ctx.reply(MAIN_MENU_TITLE, { reply_markup: kb });
  });

  return bot as unknown as Bot;
}
