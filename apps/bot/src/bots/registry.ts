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
import { eq, and, asc, desc, sql } from "drizzle-orm";
import { db } from "@tg-business/db";
import {
  tenants,
  tenantBots,
  businessConnections,
  conversations as convTable,
  messages,
  documents,
} from "@tg-business/db";
import { decrypt } from "@tg-business/crypto";
import { uploadFile, b2BucketId } from "@tg-business/storage";
import { askAI } from "../services/ai";
import { updateBot, listDocuments, deleteDocument } from "../lib/api";
import {
  checkQuota,
  decrementDocCount,
  decrementMessageCount,
  incrementDocCount,
  incrementMessageCount,
} from "../lib/owners";
import { inngest } from "../inngest/client";
import { logger } from "../lib/logger";
import {
  createReplyCallbackData,
  createReplyCancelCallbackData,
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
import { sequentializeByChat } from "../lib/sequentialize";
import { ownerCaptureMiddleware } from "../lib/owner-capture";
import { limit } from "@grammyjs/ratelimiter";
import { isBusinessChatUpdate } from "../lib/business-update";
import {
  type BusinessBotRights,
  canReadMessages,
  canReply,
  formatPermissions,
} from "../lib/business-rights";
import {
  customerMessageLimiter,
  permissionRefreshLimiter,
} from "../lib/redis";
import {
  getDailyAiReplyCount,
  incrDailyAiReplyCount,
} from "../lib/daily-ai-limit";
import {
  effectiveDailyAiReplyCap,
  PLANS,
  type PlanKey,
  validateDailyCap,
} from "../lib/plans";
import { forwardMessageAsBusinessReply } from "../lib/business-reply";
import {
  claimPermissionAlertSlot,
  clearPermissionAlertSlot,
} from "../lib/permission-alert";
import { UpstashSessionStorage } from "../lib/session-storage";
import {
  BOT_NOT_FOUND,
  DOC_DELETED,
  DOC_DELETE_FAILED,
  DOC_NO_FILE_ACCESS,
  DOC_PROCESSING,
  DOC_QUEUED,
  DOC_RAG_NOT_CONFIGURED,
  DOC_UNSUPPORTED,
  PROMPT_UPDATED,
  REPLY_CANCELLED,
  REPLY_FAILED_GENERIC,
  REPLY_PROMPT_BODY,
  REPLY_SENT,
  REPLY_UNSUPPORTED_TYPE,
  SEND_TEXT_PLEASE,
  SUBSCRIBE_TO_UPLOAD,
  docUploadBlocked,
  TOAST_BOT_NOT_LOADED,
  TOAST_AUTOREAD_OFF,
  TOAST_AUTOREAD_ON,
  TOAST_NO_BUSINESS_CONNECTION,
  TOAST_PERMISSIONS_FETCH_FAILED,
  TOAST_PERMISSIONS_REFRESHED,
  TOAST_REFRESH_RATE_LIMITED,
  TOAST_REPLY_EXPIRED,
  TOAST_STALE_CALLBACK,
  TOAST_TAP_TRASH_TO_DELETE,
  WELCOME_NO_CUSTOM,
  DAILY_AI_CAP_REACHED_REPLY,
  WELCOME_RESET,
  WELCOME_UPDATED,
  adminEscalation,
  DAILY_CAP_MESSAGE_MAX_LENGTH,
  DAILY_CAP_MESSAGE_RESET,
  DAILY_CAP_MESSAGE_TOO_LONG,
  truncateMid,
  tenantHelp,
  dailyCapButtonLabel,
  dailyCapEditorBody,
  dailyCapInvalid,
  dailyCapMessageEditorBody,
  dailyCapMessageUpdated,
  dailyCapUpdated,
  botConnectedAlert,
  botDisconnectedAlert,
  customerReplyFailedAlert,
  docAddPrompt,
  docConfirmDelete,
  docIngestFailed,
  docLimitReached,
  docListEmpty,
  docListHeader,
  docTooLarge,
  editPromptHeader,
  managementMenu,
  missingCanReplyAlert,
  permissionsPanel,
  replyFailedNoPermission,
  replyPromptContext,
  welcomeCurrent,
  welcomeEditorBody,
} from "../lib/text";

type BaseCtx = Context & SessionFlavor<Record<string, never>>;
type BizCtx = BaseCtx & ConversationFlavor<BaseCtx>;

interface BotEntry {
  bot: Bot<Context>;
  token: string;
  tenantId: string;
  ownerTelegramId: string;
  systemPrompt: string;
  welcomeMessage: string | null;
  autoReadBusinessMessages: boolean;
  dailyUserAiReplyLimit: number | null;
  dailyCapReachedMessage: string | null;
  botUsername: string;
  connectedBusinessUserId: string | null;
  webhookSecret: string;
  // Latest business-connection state for this bot. businessRights drives the
  // pre-flight gating on readBusinessMessage and the AI reply path.
  businessConnectionId: string | null;
  businessRights: BusinessBotRights | null;
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
    await ctx.reply(BOT_NOT_FOUND);
    return;
  }

  // Fetch the at-a-glance fields the header surfaces. Two cheap reads —
  // an indexed COUNT(*) and a single-row lookup. Both fail-open: a DB
  // hiccup degrades the header rather than blocking the menu.
  const [docRows, connRow] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(documents)
      .where(eq(documents.tenantBotId, botId))
      .catch(() => [{ count: 0 }] as { count: number }[]),
    db.query.businessConnections
      .findFirst({
        where: and(
          eq(businessConnections.tenantBotId, botId),
          eq(businessConnections.isEnabled, true),
        ),
        columns: { id: true },
      })
      .catch(() => null),
  ]);
  const documentCount = docRows[0]?.count ?? 0;
  const connectionLinked = connRow !== null && connRow !== undefined;

  const statusIcon = botRecord.status === "active" ? "✅ Active" : "⏸ Paused";
  const autoReadLabel = `👁 Auto-read: ${botRecord.autoReadBusinessMessages ? "On" : "Off"}`;
  const capLabel = dailyCapButtonLabel(botRecord.dailyUserAiReplyLimit);
  const kb = new InlineKeyboard()
    .text("✏️ Prompt", "biz_edit_prompt")
    .text("💬 Welcome", "biz_edit_welcome")
    .row()
    .text("📚 Knowledge", "biz_documents")
    .text(capLabel, "biz_edit_daily_cap")
    .row()
    .text(autoReadLabel, "biz_toggle_autoread")
    .text("🔒 Permissions", "biz_permissions")
    .row();

  const text = managementMenu({
    username: botRecord.botUsername ?? "",
    statusIcon,
    connectionLinked,
    documentCount,
    firstName: ctx.from?.first_name ?? null,
  });

  // Always send a new message. Callers inside a conversation are expected
  // to delete their last tracked screen message before invoking this.
  await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
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
      await ctx.reply(BOT_NOT_FOUND);
      return;
    }

    const chatId = ctx.chat!.id;
    // Track the prompt-screen message id so each "update" deletes the old
    // one and sends a new one (editMessageText would leave it stranded
    // above any progress messages the bot sent in between).
    let screenMsgId: number | null = ctx.callbackQuery?.message?.message_id ?? null;

    if (screenMsgId !== null) {
      await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
    }
    let sent = await ctx.reply(
      editPromptHeader({
        username: botRecord.botUsername ?? "",
        prompt: botRecord.systemPrompt,
      }),
      { reply_markup: cancelKb },
    );
    screenMsgId = sent.message_id;

    while (true) {
      const response = await conversation.wait();

      if (response.callbackQuery?.data === "biz_cancel") {
        await response.answerCallbackQuery();
        if (screenMsgId !== null) {
          await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
          screenMsgId = null;
        }
        await showManagementMenu(response, botId);
        return;
      }

      if (response.callbackQuery) {
        // Unknown / stale button — exit cleanly to the management menu.
        await response.answerCallbackQuery({ text: TOAST_STALE_CALLBACK });
        await response.deleteMessage().catch(() => {});
        if (screenMsgId !== null) {
          await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
          screenMsgId = null;
        }
        await showManagementMenu(response, botId);
        return;
      }

      const newPrompt = response.message?.text?.trim();
      if (!newPrompt) {
        if (screenMsgId !== null) {
          await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        }
        sent = await ctx.reply(SEND_TEXT_PLEASE, {
          reply_markup: cancelKb,
        });
        screenMsgId = sent.message_id;
        continue;
      }

      // updateBot must be wrapped so a later replay (e.g. owner navigates
      // back, or any subsequent update inside this conversation) does not
      // re-issue the DB write.
      await conversation.external(() =>
        updateBot(botId, { systemPrompt: newPrompt }),
      );
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        screenMsgId = null;
      }
      await ctx.reply(PROMPT_UPDATED);
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
      await ctx.reply(BOT_NOT_FOUND);
      return;
    }

    const kb = new InlineKeyboard()
      .text("↺ Reset to default", "biz_welcome_reset")
      .row()
      .text("Cancel", "biz_cancel");

    const current = botRecord.welcomeMessage?.trim()
      ? welcomeCurrent(botRecord.welcomeMessage)
      : WELCOME_NO_CUSTOM;

    const chatId = ctx.chat!.id;
    let screenMsgId: number | null = ctx.callbackQuery?.message?.message_id ?? null;

    if (screenMsgId !== null) {
      await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
    }
    let sent = await ctx.reply(welcomeEditorBody(current), {
      reply_markup: kb,
    });
    screenMsgId = sent.message_id;

    while (true) {
      const response = await conversation.wait();

      if (response.callbackQuery?.data === "biz_cancel") {
        await response.answerCallbackQuery();
        if (screenMsgId !== null) {
          await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
          screenMsgId = null;
        }
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
        if (screenMsgId !== null) {
          await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
          screenMsgId = null;
        }
        await response.reply(WELCOME_RESET);
        await showManagementMenu(response, botId);
        return;
      }

      if (response.callbackQuery) {
        // Unknown / stale button — exit cleanly to the management menu.
        await response.answerCallbackQuery({ text: TOAST_STALE_CALLBACK });
        await response.deleteMessage().catch(() => {});
        if (screenMsgId !== null) {
          await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
          screenMsgId = null;
        }
        await showManagementMenu(response, botId);
        return;
      }

      const newWelcome = response.message?.text?.trim();
      if (!newWelcome) {
        if (screenMsgId !== null) {
          await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        }
        sent = await ctx.reply(SEND_TEXT_PLEASE, {
          reply_markup: kb,
        });
        screenMsgId = sent.message_id;
        continue;
      }

      await conversation.external(async () => {
        await updateBot(botId, { welcomeMessage: newWelcome });
        onSaved(newWelcome);
      });
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        screenMsgId = null;
      }
      await ctx.reply(WELCOME_UPDATED);
      await showManagementMenu(ctx, botId);
      return;
    }
  };
}

/**
 * Inline busy-reply editor screen. Used by both the top-level
 * `editCapMessage` conversation (legacy entry — kept registered so any
 * stale `biz_edit_cap_message` button in a chat's history still works)
 * and the nested-in-Daily-limit-editor invocation. The outcome lets the
 * caller decide where to navigate next.
 */
type BusyReplyOutcome = "saved" | "reset" | "canceled" | "stale";

async function runBusyReplyEditorScreen(
  conversation: Conversation<BaseCtx, BaseCtx>,
  ctx: BaseCtx,
  botId: string,
  onSaved: (newValue: string | null) => void,
): Promise<BusyReplyOutcome> {
  const botRecord = await db.query.tenantBots.findFirst({
    where: eq(tenantBots.id, botId),
  });
  if (!botRecord) {
    await ctx.reply(BOT_NOT_FOUND);
    return "stale";
  }

  const kb = new InlineKeyboard()
    .text("↺ Use default", "biz_cap_msg_reset")
    .row()
    .text("Cancel", "biz_cancel");

  const chatId = ctx.chat!.id;
  let screenMsgId: number | null =
    ctx.callbackQuery?.message?.message_id ?? null;

  if (screenMsgId !== null) {
    await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
  }
  let sent = await ctx.reply(
    dailyCapMessageEditorBody({
      currentValue: botRecord.dailyCapReachedMessage,
    }),
    { reply_markup: kb },
  );
  screenMsgId = sent.message_id;

  while (true) {
    const response = await conversation.wait();

    if (response.callbackQuery?.data === "biz_cancel") {
      await response.answerCallbackQuery();
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
      }
      return "canceled";
    }

    if (response.callbackQuery?.data === "biz_cap_msg_reset") {
      await response.answerCallbackQuery();
      await conversation.external(async () => {
        await updateBot(botId, { dailyCapReachedMessage: null });
        onSaved(null);
      });
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
      }
      await response.reply(DAILY_CAP_MESSAGE_RESET);
      return "reset";
    }

    if (response.callbackQuery) {
      await response.answerCallbackQuery({ text: TOAST_STALE_CALLBACK });
      await response.deleteMessage().catch(() => {});
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
      }
      return "stale";
    }

    const text = response.message?.text?.trim() ?? "";
    if (!text) {
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
      }
      sent = await ctx.reply(SEND_TEXT_PLEASE, { reply_markup: kb });
      screenMsgId = sent.message_id;
      continue;
    }
    if (text.length > DAILY_CAP_MESSAGE_MAX_LENGTH) {
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
      }
      sent = await ctx.reply(DAILY_CAP_MESSAGE_TOO_LONG, { reply_markup: kb });
      screenMsgId = sent.message_id;
      continue;
    }

    await conversation.external(async () => {
      await updateBot(botId, { dailyCapReachedMessage: text });
      onSaved(text);
    });
    if (screenMsgId !== null) {
      await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
    }
    await ctx.reply(dailyCapMessageUpdated(text));
    return "saved";
  }
}

function makeEditDailyCapConversation(
  botId: string,
  ownerTelegramId: string,
  onSavedLimit: (newValue: number | null) => void,
  onSavedMessage: (newValue: string | null) => void,
) {
  return async function editDailyCapConversation(
    conversation: Conversation<BaseCtx, BaseCtx>,
    ctx: BaseCtx,
  ) {
    // Use the owner's effective plan (via checkQuota — already does the
    // banned/lapsed defenses) as the ceiling. Lapsed → fall back to trial
    // ceiling so the UI still shows a sane bound; bot would be paused
    // anyway via over_quota_at and editing the cap is harmless then.
    const quota = await checkQuota(ownerTelegramId, "message");
    const planForCeiling: PlanKey = quota.plan ?? "trial";
    const ceiling = PLANS[planForCeiling].maxMessagesPerPeriod;

    const kb = new InlineKeyboard()
      .text("Set to Off", "biz_daily_cap_off")
      .text("✉️ Edit busy reply", "biz_edit_cap_message")
      .row()
      .text("Cancel", "biz_cancel");

    const chatId = ctx.chat!.id;
    let screenMsgId: number | null =
      ctx.callbackQuery?.message?.message_id ?? null;

    // Draw the editor screen — used both on entry and after the
    // busy-reply sub-editor finishes.
    async function drawScreen(): Promise<void> {
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        screenMsgId = null;
      }
      const fresh = await db.query.tenantBots.findFirst({
        where: eq(tenantBots.id, botId),
      });
      if (!fresh) {
        await ctx.reply(BOT_NOT_FOUND);
        return;
      }
      const sent = await ctx.reply(
        dailyCapEditorBody({
          currentValue: fresh.dailyUserAiReplyLimit,
          ceiling,
        }),
        { reply_markup: kb },
      );
      screenMsgId = sent.message_id;
    }

    const initial = await db.query.tenantBots.findFirst({
      where: eq(tenantBots.id, botId),
    });
    if (!initial) {
      await ctx.reply(BOT_NOT_FOUND);
      return;
    }
    await drawScreen();

    while (true) {
      const response = await conversation.wait();

      if (response.callbackQuery?.data === "biz_cancel") {
        await response.answerCallbackQuery();
        if (screenMsgId !== null) {
          await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
          screenMsgId = null;
        }
        await showManagementMenu(response, botId);
        return;
      }

      if (response.callbackQuery?.data === "biz_daily_cap_off") {
        await response.answerCallbackQuery();
        await conversation.external(async () => {
          await updateBot(botId, { dailyUserAiReplyLimit: null });
          onSavedLimit(null);
        });
        if (screenMsgId !== null) {
          await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
          screenMsgId = null;
        }
        await response.reply(dailyCapUpdated(null));
        await showManagementMenu(response, botId);
        return;
      }

      if (response.callbackQuery?.data === "biz_edit_cap_message") {
        await response.answerCallbackQuery();
        // Hand control to the inline busy-reply editor; on return,
        // redraw the daily-limit screen so the owner stays in this
        // configuration surface.
        if (screenMsgId !== null) {
          await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
          screenMsgId = null;
        }
        const outcome = await runBusyReplyEditorScreen(
          conversation,
          response,
          botId,
          onSavedMessage,
        );
        if (outcome === "stale") {
          await showManagementMenu(response, botId);
          return;
        }
        await drawScreen();
        continue;
      }

      if (response.callbackQuery) {
        await response.answerCallbackQuery({ text: TOAST_STALE_CALLBACK });
        await response.deleteMessage().catch(() => {});
        if (screenMsgId !== null) {
          await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
          screenMsgId = null;
        }
        await showManagementMenu(response, botId);
        return;
      }

      const raw = response.message?.text?.trim() ?? "";
      if (!raw) continue;

      // Accept either bare integers or "off" / "none" / "unlimited" as
      // synonyms for clearing the cap.
      const lowered = raw.toLowerCase();
      if (
        lowered === "off" ||
        lowered === "none" ||
        lowered === "unlimited" ||
        lowered === "0"
      ) {
        await conversation.external(async () => {
          await updateBot(botId, { dailyUserAiReplyLimit: null });
          onSavedLimit(null);
        });
        if (screenMsgId !== null) {
          await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
          screenMsgId = null;
        }
        await ctx.reply(dailyCapUpdated(null));
        await showManagementMenu(ctx, botId);
        return;
      }

      const parsed = Number.parseInt(raw, 10);
      const verdict = validateDailyCap(
        Number.isFinite(parsed) ? parsed : Number.NaN,
        planForCeiling,
      );
      if (!verdict.ok) {
        if (screenMsgId !== null) {
          await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        }
        const sent = await ctx.reply(
          dailyCapInvalid({ reason: verdict.reason, ceiling: verdict.ceiling }),
          { reply_markup: kb },
        );
        screenMsgId = sent.message_id;
        continue;
      }

      const newValue = verdict.value;
      await conversation.external(async () => {
        await updateBot(botId, { dailyUserAiReplyLimit: newValue });
        onSavedLimit(newValue);
      });
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        screenMsgId = null;
      }
      await ctx.reply(dailyCapUpdated(newValue));
      await showManagementMenu(ctx, botId);
      return;
    }
  };
}

function makeEditCapMessageConversation(
  botId: string,
  onSaved: (newValue: string | null) => void,
) {
  return async function editCapMessageConversation(
    conversation: Conversation<BaseCtx, BaseCtx>,
    ctx: BaseCtx,
  ) {
    await runBusyReplyEditorScreen(conversation, ctx, botId, onSaved);
    await showManagementMenu(ctx, botId);
  };
}

function makeDocumentManagementConversation(
  botId: string,
  tenantId: string,
  botToken: string,
  ownerTelegramId: string,
) {
  return async function documentMgmtConversation(
    conversation: Conversation<BaseCtx, BaseCtx>,
    ctx: BaseCtx,
  ) {
    const chatId = ctx.chat!.id;
    // The current "screen" (docs list, confirm-delete, add-doc prompt) is
    // tracked by id so each update deletes the previous one and posts a new
    // one — keeps the screen at the bottom of the chat even after the bot
    // sent progress messages in between.
    let screenMsgId: number | null = ctx.callbackQuery?.message?.message_id ?? null;

    async function showDocsList() {
      const docs = await listDocuments(botId);
      const kb = new InlineKeyboard();
      for (const d of docs) {
        const statusIcon =
          d.status === "ready" ? "✅" : d.status === "failed" ? "❌" : "⏳";
        kb.text(
          `${statusIcon} ${truncateMid(d.fileName, 25)}`,
          `biz_docitem_${d.id}`,
        )
          .text("🗑️", `biz_del_doc_${d.id}`)
          .row();
      }
      kb.text("➕ Add Document", "biz_add_doc").row();
      kb.text("🔙 Back", "biz_doc_back");

      const text =
        docs.length === 0
          ? docListEmpty({
              max: MAX_DOCUMENTS_PER_BOT,
              sizeLabel: formatBytes(MAX_DOCUMENT_SIZE_BYTES),
            })
          : docListHeader({ count: docs.length, max: MAX_DOCUMENTS_PER_BOT });

      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
      }
      const sent = await ctx.reply(text, { reply_markup: kb });
      screenMsgId = sent.message_id;
    }

    async function confirmDelete(docId: string, fileName: string) {
      const confirmKb = new InlineKeyboard()
        .text("✅ Yes, delete", `biz_confirm_del_${docId}`)
        .text("❌ No", "biz_doc_cancel");
      if (screenMsgId !== null) {
        await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
      }
      const sent = await ctx.reply(docConfirmDelete(fileName), {
        reply_markup: confirmKb,
      });
      screenMsgId = sent.message_id;
    }

    await showDocsList();

    while (true) {
      const response = await conversation.wait();

      if (response.callbackQuery?.data === "biz_doc_back") {
        await response.answerCallbackQuery();
        if (screenMsgId !== null) {
          await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
          screenMsgId = null;
        }
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
        // Plan-cap quota gate. Lapsed/banned owners get the subscribe CTA;
        // at-cap owners on a paid plan get the plan-aware blocked message.
        // Falls through to the legacy MAX_DOCUMENTS_PER_BOT only when the
        // owner has no row / quota check fails open.
        const quota = await conversation.external(() =>
          checkQuota(ownerTelegramId, "doc", { botId }),
        );
        if (!quota.ok) {
          const message =
            quota.reason === "lapsed" || quota.reason === "banned"
              ? SUBSCRIBE_TO_UPLOAD
              : docUploadBlocked({
                  cap: quota.limit,
                  planLabel: quota.plan ?? "",
                });
          if (screenMsgId !== null) {
            await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
          }
          const sent = await ctx.reply(message, {
            reply_markup: new InlineKeyboard().text(
              "🔙 Back",
              "biz_doc_cancel",
            ),
            parse_mode: "HTML",
          });
          screenMsgId = sent.message_id;
          continue;
        }
        const existing = await listDocuments(botId);
        if (existing.length >= MAX_DOCUMENTS_PER_BOT) {
          if (screenMsgId !== null) {
            await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
          }
          const sent = await ctx.reply(
            docLimitReached(MAX_DOCUMENTS_PER_BOT),
            {
              reply_markup: new InlineKeyboard().text(
                "🔙 Back",
                "biz_doc_cancel",
              ),
            },
          );
          screenMsgId = sent.message_id;
          continue;
        }
        if (screenMsgId !== null) {
          await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
        }
        const sent = await ctx.reply(
          docAddPrompt({
            sizeLabel: formatBytes(MAX_DOCUMENT_SIZE_BYTES),
            max: MAX_DOCUMENTS_PER_BOT,
          }),
          {
            reply_markup: new InlineKeyboard().text("Cancel", "biz_doc_cancel"),
          },
        );
        screenMsgId = sent.message_id;
        continue;
      }

      if (response.callbackQuery?.data?.startsWith("biz_docitem_")) {
        await response.answerCallbackQuery({
          text: TOAST_TAP_TRASH_TO_DELETE,
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
          // Decrement the per-owner denormalized counter. Fail-open inside
          // owners.ts — drift is reconciled by cron/usage.reconcile.
          await conversation.external(() => decrementDocCount(ownerTelegramId));
          await ctx.reply(DOC_DELETED);
        } catch (err) {
          await ctx.reply(DOC_DELETE_FAILED);
        }
        await showDocsList();
        continue;
      }

      if (response.callbackQuery) {
        // Unknown / stale button — exit cleanly to the management menu.
        await response.answerCallbackQuery({ text: TOAST_STALE_CALLBACK });
        await response.deleteMessage().catch(() => {});
        if (screenMsgId !== null) {
          await ctx.api.deleteMessage(chatId, screenMsgId).catch(() => {});
          screenMsgId = null;
        }
        await showManagementMenu(response, botId);
        return;
      }

      const doc = response.message?.document;
      const detectedMime = doc
        ? detectMimeType(doc.file_name, doc.mime_type)
        : null;
      if (!doc || !detectedMime) {
        await ctx.reply(DOC_UNSUPPORTED, { reply_markup: docCancelKb });
        continue;
      }

      // Plan-cap quota gate at upload time. Mirrors the same check on the
      // Add Document tap above so an in-flight conversation can't race past
      // the cap (e.g. owner had the upload prompt open when their sub
      // lapsed). On block: silent skip of the upload, plain reply to owner.
      const uploadQuota = await conversation.external(() =>
        checkQuota(ownerTelegramId, "doc", { botId }),
      );
      if (!uploadQuota.ok) {
        const message =
          uploadQuota.reason === "lapsed" || uploadQuota.reason === "banned"
            ? SUBSCRIBE_TO_UPLOAD
            : docUploadBlocked({
                cap: uploadQuota.limit,
                planLabel: uploadQuota.plan ?? "",
              });
        await ctx.reply(message, {
          reply_markup: docCancelKb,
          parse_mode: "HTML",
        });
        continue;
      }

      const existing = await listDocuments(botId);
      const limitCheck = checkDocumentLimits({
        fileSize: doc.file_size,
        currentDocCount: existing.length,
      });
      if (!limitCheck.ok) {
        if (limitCheck.reason === "too_many") {
          await ctx.reply(docLimitReached(limitCheck.limit), {
            reply_markup: docCancelKb,
          });
        } else {
          await ctx.reply(
            docTooLarge({
              size: formatBytes(limitCheck.size),
              limit: formatBytes(limitCheck.limit),
            }),
            { reply_markup: docCancelKb },
          );
        }
        continue;
      }

      const workUrl = process.env.WORKER_URL;
      if (!workUrl) {
        await ctx.reply(DOC_RAG_NOT_CONFIGURED);
        return;
      }

      await ctx.reply(DOC_PROCESSING);

      const file = await ctx.api.getFile(doc.file_id);
      const filePath = file.file_path;
      if (!filePath) {
        await ctx.reply(DOC_NO_FILE_ACCESS);
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
        await ctx.reply(docIngestFailed(msg));
      }

      if (queued) {
        // Bump the per-owner doc counter. Fail-open in owners.ts.
        await conversation.external(() => incrementDocCount(ownerTelegramId));
        await ctx.reply(DOC_QUEUED);
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

    const bot = this.buildBizBot(
      rawToken,
      botId,
      row.tenantId,
      tenant.telegramOwnerId,
    );
    await bot.init();
    await this.setWebhook(bot, botId, row.webhookSecret);
    this.attachHandlers(
      bot,
      botId,
      tenant.telegramOwnerId,
      row.systemPrompt,
      row.botUsername ?? "",
    );
    const conn = await this.loadActiveBusinessConnection(botId);
    this.bots.set(botId, {
      bot,
      token: rawToken,
      tenantId: row.tenantId,
      ownerTelegramId: tenant.telegramOwnerId,
      systemPrompt: row.systemPrompt,
      welcomeMessage: row.welcomeMessage,
      autoReadBusinessMessages: row.autoReadBusinessMessages,
      dailyUserAiReplyLimit: row.dailyUserAiReplyLimit,
      dailyCapReachedMessage: row.dailyCapReachedMessage,
      botUsername: row.botUsername ?? "",
      connectedBusinessUserId: row.connectedBusinessUserId,
      webhookSecret: row.webhookSecret,
      businessConnectionId: conn.businessConnectionId,
      businessRights: conn.businessRights,
    });
    return bot;
  }

  private async loadActiveBusinessConnection(
    tenantBotId: string,
  ): Promise<{
    businessConnectionId: string | null;
    businessRights: BusinessBotRights | null;
  }> {
    const row = await db.query.businessConnections.findFirst({
      where: and(
        eq(businessConnections.tenantBotId, tenantBotId),
        eq(businessConnections.isEnabled, true),
      ),
      orderBy: [desc(businessConnections.lastSyncedAt)],
    });
    return {
      businessConnectionId: row?.businessConnectionId ?? null,
      businessRights: (row?.rights as BusinessBotRights | undefined) ?? null,
    };
  }

  private buildBizBot(
    rawToken: string,
    botId: string,
    tenantId: string,
    ownerTelegramId: string,
  ): Bot<Context> {
    const bot = new Bot<BizCtx>(rawToken);
    // Owner-side rate limit. 30 updates / 60 s per Telegram user, applied
    // only to non-business-chat updates — i.e. owner DMs to the bot, the
    // Reply/Cancel callbacks, doc-upload flows, permission Refresh, etc.
    //
    // Customer messages flowing through the Business Connection are
    // *excluded* here and instead covered by `customerMessageLimiter`
    // (10/60s per customer) before the AI call — see registry.ts where
    // it's applied to `business_message`. Two layers would either be
    // redundant or cap the AI handler with the wrong number.
    //
    // Mounted before sequentialize/session/conversations so blocked
    // updates exit before any queue work or DB lookup. Silent drop.
    const ownerSurface = bot.filter((ctx) => !isBusinessChatUpdate(ctx.update));
    ownerSurface.use(
      limit({
        timeFrame: 60_000,
        limit: 30,
        keyGenerator: (ctx) => ctx.from?.id.toString(),
        keyPrefix: `bot:${botId}:`,
      }),
    );
    // Opportunistic owner-profile upsert. Restricted to the same non-
    // business-chat filter as the rate limit above so we never capture
    // customer `from` users (whose updates flow through business_message
    // / business_connection / edited_business_message etc.) into the
    // owners table. Customers are not subscription owners.
    ownerSurface.use(ownerCaptureMiddleware());
    // Must come before session/conversations so concurrent updates from
    // the same chat (e.g. owner pressing Back while a doc upload is still
    // running) don't corrupt the conversations plugin's replay log.
    bot.use(sequentializeByChat());
    bot.use(
      session({
        initial: () => ({}),
        // Per-tenant-bot prefix is mandatory — two bots can each get a
        // message from the same chatId, so a shared prefix would clobber
        // each other's session.
        storage: new UpstashSessionStorage(`tg:session:bot:${botId}:`),
      }),
    );
    // The conversations plugin keeps its replay log in a *separate*
    // storage from session() — without this it defaults to in-memory and
    // every restart kills any in-flight conversation. Per-bot prefix so
    // two tenant bots that both serve the same chatId don't clobber each
    // other's conversation state.
    bot.use(
      grammyConvs({
        storage: {
          type: "key",
          adapter: new UpstashSessionStorage(`tg:conv:bot:${botId}:`),
        },
      }),
    );
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
        makeDocumentManagementConversation(
          botId,
          tenantId,
          rawToken,
          ownerTelegramId,
        ),
        "documentMgmt",
      ),
    );
    bot.use(
      createConversation(
        makeEditDailyCapConversation(
          botId,
          ownerTelegramId,
          (newValue) => {
            const entry = this.bots.get(botId);
            if (entry) entry.dailyUserAiReplyLimit = newValue;
          },
          (newValue) => {
            const entry = this.bots.get(botId);
            if (entry) entry.dailyCapReachedMessage = newValue;
          },
        ),
        "editDailyCap",
      ),
    );
    // The standalone `editCapMessage` conversation stays registered so any
    // stale `biz_edit_cap_message` button from the old menu layout still
    // works (the global callback handler enters this conversation).
    bot.use(
      createConversation(
        makeEditCapMessageConversation(botId, (newValue) => {
          const entry = this.bots.get(botId);
          if (entry) entry.dailyCapReachedMessage = newValue;
        }),
        "editCapMessage",
      ),
    );
    return bot as unknown as Bot<Context>;
  }

  private async createBot(
    row: typeof tenantBots.$inferSelect,
    token: string,
    tenant: typeof tenants.$inferSelect,
  ): Promise<Bot<Context>> {
    const bot = this.buildBizBot(
      token,
      row.id,
      row.tenantId,
      tenant.telegramOwnerId,
    );
    await bot.init();
    await this.setWebhook(bot, row.id, row.webhookSecret);
    this.attachHandlers(
      bot,
      row.id,
      tenant.telegramOwnerId,
      row.systemPrompt,
      row.botUsername ?? "",
    );
    const conn = await this.loadActiveBusinessConnection(row.id);
    this.bots.set(row.id, {
      bot,
      token,
      tenantId: row.tenantId,
      ownerTelegramId: tenant.telegramOwnerId,
      systemPrompt: row.systemPrompt,
      welcomeMessage: row.welcomeMessage,
      autoReadBusinessMessages: row.autoReadBusinessMessages,
      dailyUserAiReplyLimit: row.dailyUserAiReplyLimit,
      dailyCapReachedMessage: row.dailyCapReachedMessage,
      botUsername: row.botUsername ?? "",
      connectedBusinessUserId: row.connectedBusinessUserId,
      webhookSecret: row.webhookSecret,
      businessConnectionId: conn.businessConnectionId,
      businessRights: conn.businessRights,
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
        // Register /start and /help in the owner's slash-menu the first
        // time they /start. Scoped to this chat, so customers using the
        // same bot don't see /help (which would confuse them — it's a
        // management surface they shouldn't tap into). Fire-and-forget;
        // a transient Telegram error here shouldn't block the menu.
        const fromId = ctx.from?.id;
        if (fromId !== undefined) {
          ctx.api
            .setMyCommands(
              [
                { command: "start", description: "Open the management menu" },
                { command: "help", description: "Show help" },
              ],
              { scope: { type: "chat", chat_id: fromId } },
            )
            .catch((err) => {
              logger.warn(
                { err, botId, fromId },
                "setMyCommands for owner failed",
              );
            });
        }
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

    bot.command("help", async (ctx) => {
      const ownerId = String(ctx.from?.id ?? "");
      // Only respond to the bot owner. Customers hitting /help would just
      // be confused by management-menu copy, so silently ignore them.
      if (!this.findByOwner(ownerId)) return;
      const botEntry = this.bots.get(botId);
      await ctx.reply(
        tenantHelp({ username: botEntry?.botUsername ?? "" }),
        { parse_mode: "HTML" },
      );
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

    bot.callbackQuery("biz_edit_daily_cap", async (ctx) => {
      await ctx.answerCallbackQuery();
      await (ctx as unknown as BizCtx).conversation.enter("editDailyCap");
    });

    bot.callbackQuery("biz_edit_cap_message", async (ctx) => {
      await ctx.answerCallbackQuery();
      await (ctx as unknown as BizCtx).conversation.enter("editCapMessage");
    });

    bot.callbackQuery("biz_toggle_autoread", async (ctx) => {
      const entry = this.bots.get(botId);
      if (!entry) {
        await ctx.answerCallbackQuery({ text: TOAST_BOT_NOT_LOADED });
        return;
      }
      const newValue = !entry.autoReadBusinessMessages;
      await updateBot(botId, { autoReadBusinessMessages: newValue });
      // Reflect in the cached entry so the business_message handler picks
      // up the new value without waiting for a registry reload.
      entry.autoReadBusinessMessages = newValue;
      await ctx.answerCallbackQuery({
        text: newValue ? TOAST_AUTOREAD_ON : TOAST_AUTOREAD_OFF,
      });
      await ctx.deleteMessage().catch(() => {});
      await showManagementMenu(ctx, botId);
    });

    bot.callbackQuery("biz_permissions", async (ctx) => {
      await ctx.answerCallbackQuery();
      const entry = this.bots.get(botId);
      if (!entry) return;
      const text = permissionsPanel(formatPermissions(entry.businessRights));
      const permKb = new InlineKeyboard()
        .text("🔄 Refresh", "biz_refresh_permissions")
        .row()
        .text("🔙 Back", "biz_perm_back");
      await ctx.deleteMessage().catch(() => {});
      await ctx.reply(text, { reply_markup: permKb });
    });

    bot.callbackQuery("biz_refresh_permissions", async (ctx) => {
      const entry = this.bots.get(botId);
      if (!entry) {
        await ctx.answerCallbackQuery({ text: TOAST_BOT_NOT_LOADED });
        return;
      }
      if (!entry.businessConnectionId) {
        await ctx.answerCallbackQuery({
          text: TOAST_NO_BUSINESS_CONNECTION,
        });
        return;
      }
      // Stop double-taps from firing two getBusinessConnection requests
      // against Telegram in quick succession. Fail open if Redis is down —
      // a missed rate-limit is harmless here.
      const rl = await permissionRefreshLimiter()
        .limit(botId)
        .catch(() => ({ success: true } as { success: boolean }));
      if (!rl.success) {
        await ctx.answerCallbackQuery({
          text: TOAST_REFRESH_RATE_LIMITED,
        });
        return;
      }
      try {
        const conn = await ctx.api.getBusinessConnection(
          entry.businessConnectionId,
        );
        const fresh = (conn.rights ?? null) as BusinessBotRights | null;
        entry.businessRights = fresh;
        await db
          .update(businessConnections)
          .set({
            isEnabled: Boolean(conn.is_enabled),
            rights: fresh,
            lastSyncedAt: new Date(),
          })
          .where(
            eq(
              businessConnections.businessConnectionId,
              entry.businessConnectionId,
            ),
          );
        await ctx.answerCallbackQuery({ text: TOAST_PERMISSIONS_REFRESHED });
      } catch (err) {
        logger.warn({ err, botId }, "getBusinessConnection failed");
        await ctx.answerCallbackQuery({
          text: TOAST_PERMISSIONS_FETCH_FAILED,
        });
        return;
      }
      const text = permissionsPanel(formatPermissions(entry.businessRights));
      const permKb = new InlineKeyboard()
        .text("🔄 Refresh", "biz_refresh_permissions")
        .row()
        .text("🔙 Back", "biz_perm_back");
      await ctx.deleteMessage().catch(() => {});
      await ctx.reply(text, { reply_markup: permKb });
    });

    bot.callbackQuery("biz_perm_back", async (ctx) => {
      await ctx.answerCallbackQuery();
      await ctx.deleteMessage().catch(() => {});
      await showManagementMenu(ctx, botId);
    });

    // "✏️ Reply" button on admin escalation notifications. Activates the
    // reply target and shows a "Send your reply" prompt with a Cancel
    // button. The owner's next message of any type is copied to the
    // customer via copyMessage on the business connection.
    //
    // We deliberately do NOT delete the original notification: if the
    // owner cancels, they should still see the customer's escalation
    // and be able to re-tap Reply. The Cancel handler clears the
    // selection (but leaves the token usable); successful Send marks
    // usedAt so subsequent taps cleanly surface TOAST_REPLY_EXPIRED.
    bot.callbackQuery(/^oreply_([a-f0-9]{16})$/, async (ctx) => {
      const token = ctx.match![1]!;
      const ownerId = String(ctx.from?.id ?? "");
      const target = await this.ownerReplyTargets.activate(ownerId, token);
      if (!target) {
        await ctx.answerCallbackQuery({ text: TOAST_REPLY_EXPIRED });
        return;
      }
      await ctx.answerCallbackQuery();

      const contextLine = target.customerLabel
        ? replyPromptContext(escapeHtml(target.customerLabel))
        : "";
      const cancelKb = new InlineKeyboard().text(
        "✕ Cancel",
        createReplyCancelCallbackData(token),
      );
      const prompt = await ctx.reply(`${contextLine}${REPLY_PROMPT_BODY}`, {
        reply_markup: cancelKb,
        parse_mode: "HTML",
      });
      await this.ownerReplyTargets
        .setPromptMessageId(token, prompt.message_id)
        .catch((err) => {
          logger.warn(
            { err, botId, token },
            "failed to record reply-prompt message id",
          );
        });
    });

    // "✕ Cancel" button on the reply prompt — clear the active
    // selection (leaving the token usable), delete the prompt, and let
    // the owner know they can retry by tapping Reply again on the
    // original notification.
    bot.callbackQuery(/^oreply_cancel_([a-f0-9]{16})$/, async (ctx) => {
      const token = ctx.match![1]!;
      await ctx.answerCallbackQuery();
      await this.ownerReplyTargets.clearSelection(token);
      await ctx.deleteMessage().catch(() => {});
      await ctx.reply(REPLY_CANCELLED);
    });

    // Catch-all: callbacks no earlier handler matched. Buttons left over
    // after a process restart or stale screens whose state is gone. For
    // owner clicks, surface the stale-callback toast and drop them back
    // on the management menu; for non-owners (shouldn't really happen),
    // just acknowledge silently.
    bot.on("callback_query:data", async (ctx) => {
      const ownerId = String(ctx.from?.id ?? "");
      if (!this.findByOwner(ownerId)) {
        await ctx.answerCallbackQuery().catch(() => {});
        return;
      }
      await ctx
        .answerCallbackQuery({ text: TOAST_STALE_CALLBACK })
        .catch(() => {});
      await ctx.deleteMessage().catch(() => {});
      await showManagementMenu(ctx, botId);
    });

    // --- Business connection ---

    bot.on("business_connection", async (ctx) => {
      const conn = ctx.update.business_connection;
      if (!conn?.user) return;

      const botEntry = this.bots.get(botId);
      if (!botEntry) return;

      const userId = String(conn.user.id);
      const isEnabled = Boolean(conn.is_enabled);
      const rights = (conn.rights ?? null) as BusinessBotRights | null;

      // Capture the prior isEnabled BEFORE upsert so we can detect
      // transitions. `null` means we've never seen this connection.
      // Telegram re-emits business_connection on every state change
      // (rights tweaks too), so without this transition check we'd spam
      // the owner on rights edits.
      const existing = await db.query.businessConnections.findFirst({
        where: eq(businessConnections.businessConnectionId, conn.id),
        columns: { isEnabled: true },
      });
      const wasEnabled = existing?.isEnabled ?? null;

      // Upsert the connection row keyed by business_connection_id. This
      // is the authoritative refresh point for both is_enabled and rights.
      await db
        .insert(businessConnections)
        .values({
          tenantId: botEntry.tenantId,
          tenantBotId: botId,
          businessConnectionId: conn.id,
          telegramUserId: userId,
          isEnabled,
          rights,
          lastSyncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: businessConnections.businessConnectionId,
          set: {
            telegramUserId: userId,
            isEnabled,
            rights,
            lastSyncedAt: new Date(),
          },
        });

      // Refresh the cached entry so the per-message hot path sees the new
      // state without waiting for a registry reload.
      botEntry.businessConnectionId = conn.id;
      botEntry.businessRights = rights;
      // The owner may have re-granted can_reply after we previously alerted
      // them — drop the Redis alert slot so a future regression triggers a
      // fresh alert immediately instead of waiting out the 30-min TTL.
      if (canReply(rights)) {
        await clearPermissionAlertSlot(botId).catch((err) => {
          logger.warn({ err, botId }, "failed to clear permission alert slot");
        });
      }

      // Keep the legacy tenant_bots.connectedBusinessUserId cache for older
      // callers (welcome rendering, etc.). Only set it the first time so we
      // don't silently switch business accounts on a stale bot row.
      if (!botEntry.connectedBusinessUserId) {
        botEntry.connectedBusinessUserId = userId;
        await db
          .update(tenantBots)
          .set({ connectedBusinessUserId: userId })
          .where(eq(tenantBots.id, botId));
        logger.info({ botId, userId }, "business connection authorized");
      }

      const justConnected = isEnabled && wasEnabled !== true;
      const justDisconnected = !isEnabled && wasEnabled === true;

      if (justConnected) {
        logger.info(
          { botId, connId: conn.id, firstConnect: wasEnabled === null },
          "business connection enabled",
        );
        try {
          await ctx.api.sendMessage(
            Number(botEntry.ownerTelegramId),
            botConnectedAlert({
              username: botEntry.botUsername,
              includesPermissionWarning: !canReply(rights),
            }),
          );
        } catch (err) {
          logger.warn({ err, botId }, "failed to notify owner of connect");
        }
      } else if (justDisconnected) {
        logger.info({ botId, connId: conn.id }, "business connection disabled");
        try {
          await ctx.api.sendMessage(
            Number(botEntry.ownerTelegramId),
            botDisconnectedAlert(botEntry.botUsername),
          );
        } catch (err) {
          logger.warn({ err, botId }, "failed to notify owner of disable");
        }
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

        // Over-quota short-circuit. If this bot is paused due to plan limits
        // (`over_quota_at` set), customer gets silence and the owner is DM'd
        // — throttled inside the Inngest handler. Read from DB on each call
        // rather than caching in BotEntry: cheap with bot_idx, and the
        // bot/over.quota.message handler dedups via Redis anyway.
        const overQuotaRow = await db.query.tenantBots.findFirst({
          where: eq(tenantBots.id, botId),
          columns: { overQuotaAt: true },
        });
        if (overQuotaRow?.overQuotaAt !== null && overQuotaRow?.overQuotaAt !== undefined) {
          try {
            await inngest.send({
              name: "bot/over.quota.message",
              data: {
                botId,
                customerTelegramUserId: String(from?.id ?? ""),
              },
            });
          } catch (err) {
            logger.warn(
              { err, botId },
              "failed to enqueue bot/over.quota.message",
            );
          }
          return;
        }

        // Pre-flight: without can_reply we can't actually send a response,
        // so don't burn AI tokens. Alert the owner so they can fix it —
        // throttled to once per 30 min per bot via a Redis NX+EX lock so
        // process restarts don't re-spam.
        if (!canReply(botEntry.businessRights)) {
          const shouldAlert = await claimPermissionAlertSlot(botId).catch(
            (err) => {
              logger.warn({ err, botId }, "permission alert slot claim failed");
              return false;
            },
          );
          if (shouldAlert) {
            try {
              await ctx.api.sendMessage(
                Number(ownerTelegramId),
                missingCanReplyAlert({
                  customerLabelHtml: escapeHtml(customerLabel),
                  username: botEntry.botUsername,
                }),
                { parse_mode: "HTML" },
              );
            } catch (err) {
              logger.warn(
                { err, botId },
                "failed to notify owner of missing can_reply",
              );
            }
          } else {
            logger.warn(
              { botId, connId },
              "skipped customer message — can_reply not granted (owner already alerted)",
            );
          }
          return;
        }

        // Per-customer rate limit. 10 messages / 60 s sliding window —
        // protects the owner's AI-Gateway bill from a spammy customer.
        // We rate-limit by (botId, customer telegram user id) so a
        // misbehaving customer can't burn through one tenant's budget.
        const customerKey = `${botId}:${from?.id ?? "anon"}`;
        const rl = await customerMessageLimiter()
          .limit(customerKey)
          .catch((err) => {
            logger.warn({ err, botId }, "rate-limit check failed; allowing");
            return { success: true } as { success: boolean };
          });
        if (!rl.success) {
          logger.warn(
            { botId, connId, customerKey },
            "customer message rate-limited (10/60s); skipping AI",
          );
          return;
        }

        // Per-owner message quota check. Runs after the customer rate-limit
        // but before any DB writes or the AI call. On block: silent
        // customer-side (bot does not reply) per SUBSCRIPTION.md "Message
        // counter". At-cap fires bot/usage.exceeded for a once-per-period
        // owner DM (throttled inside the Inngest handler). Lapsed/banned
        // owners also bail here, but in those cases the over_quota_at
        // short-circuit above will normally have caught them already.
        const msgQuota = await checkQuota(ownerTelegramId, "message");
        if (!msgQuota.ok) {
          if (msgQuota.reason === "at_cap") {
            try {
              await inngest.send({
                name: "bot/usage.exceeded",
                data: {
                  botId,
                  ownerTelegramUserId: ownerTelegramId,
                  messagesThisPeriod: msgQuota.used,
                  cap: msgQuota.limit,
                },
              });
            } catch (err) {
              logger.warn(
                { err, botId },
                "failed to enqueue bot/usage.exceeded",
              );
            }
          }
          return;
        }

        // Per-end-user daily AI-reply cap. Owner-configurable per bot,
        // clamped at read time to the plan's monthly ceiling — see
        // `effectiveDailyAiReplyCap` in `lib/plans.ts`. Counter increments
        // only AFTER a successful AI generation (further down this
        // handler) so transient Gateway errors don't burn the end-user's
        // quota for the day. When the cap is hit the customer gets a
        // canned "we're busy" reply instead of a generated one.
        const customerId = from?.id;
        if (customerId !== undefined) {
          const cap = effectiveDailyAiReplyCap(
            botEntry.dailyUserAiReplyLimit,
            msgQuota.plan,
          );
          const used = await getDailyAiReplyCount(botId, customerId).catch(
            (err) => {
              logger.warn(
                { err, botId, customerId },
                "daily AI cap read failed; allowing this message",
              );
              return 0;
            },
          );
          if (used >= cap) {
            logger.info(
              { botId, customerId, used, cap },
              "daily AI cap reached; sending canned reply",
            );
            const capReply =
              botEntry.dailyCapReachedMessage?.trim() ||
              DAILY_AI_CAP_REACHED_REPLY;
            try {
              await ctx.api.sendMessage(chatId, capReply, {
                business_connection_id: connId,
              });
            } catch (err) {
              logger.warn(
                { err, botId, connId },
                "failed to send daily-cap canned reply",
              );
            }
            return;
          }
        }

        // Mark the customer's message as read (double-check) if the owner
        // opted in AND the bot was actually granted can_read_messages.
        // Skipping the API call when the right is missing saves a doomed
        // round-trip every customer message.
        if (
          botEntry.autoReadBusinessMessages &&
          canReadMessages(botEntry.businessRights)
        ) {
          await ctx.api
            .readBusinessMessage(connId, chatId, msg.message_id)
            .catch((err) => {
              logger.warn({ err, botId, connId }, "readBusinessMessage failed");
            });
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

        // Increment the per-owner message counter BEFORE the AI call.
        // Doomed calls (AI throws / returns null) decrement back in the
        // catch path below so failed calls don't burn the owner's budget.
        await incrementMessageCount(ownerTelegramId);

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
                  customerLabel,
                });
                const kb = new InlineKeyboard().text(
                  "✏️ Reply",
                  createReplyCallbackData(replyToken),
                );
                await ctx.api.sendMessage(
                  Number(ownerTelegramId),
                  adminEscalation({
                    customerLabelHtml: escapeHtml(customerLabel),
                    messageHtml: markdownToTelegramHtml(message),
                  }),
                  { reply_markup: kb, parse_mode: "HTML" },
                );
                return { ok: true };
              } catch (err) {
                logger.error({ err, botId }, "failed to send admin message");
                return { ok: false, error: "admin_message_send_failed" };
              }
            },
          },
        ).catch(async (err): Promise<Awaited<ReturnType<typeof askAI>>> => {
          logger.error({ err, botId }, "AI error");
          // Roll back the pre-call increment so a failed AI round-trip
          // doesn't count against the owner's monthly cap.
          await decrementMessageCount(ownerTelegramId).catch(() => {});
          return { text: null };
        });

        if (result.text !== null) {
          // Increment the per-end-user daily counter only on success.
          // Failed AI calls (caught above) decrement the owner counter but
          // never touched this one, so nothing to roll back.
          if (customerId !== undefined) {
            await incrDailyAiReplyCount(botId, customerId).catch((err) => {
              logger.warn(
                { err, botId, customerId },
                "daily AI cap incr failed",
              );
            });
          }

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
                customerReplyFailedAlert({ customerLabel, question }),
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
      if (state) {
        const entry = this.bots.get(botId);
        if (!canReply(entry?.businessRights)) {
          await ctx.reply(
            replyFailedNoPermission(entry?.botUsername ?? "your bot"),
          );
          return;
        }
        try {
          // Forward whatever the owner sent (text/photo/voice/video/…)
          // by dispatching to the matching sendXxx with the business
          // connection id. Telegram's copyMessage does NOT accept
          // business_connection_id (it'd land as the bot, not the
          // business), so we have to inspect the message type and re-send
          // via file_id — see lib/business-reply.ts for the dispatch.
          const sent = await forwardMessageAsBusinessReply(
            ctx.api,
            ctx.message,
            state.chatId,
            state.businessConnectionId,
          );
          if (!sent) {
            await ctx.reply(REPLY_UNSUPPORTED_TYPE);
            return;
          }
          await this.ownerReplyTargets.markUsed(state.token);
          // Clean up the "Send your reply" prompt so the owner's chat
          // doesn't accumulate stale prompts.
          if (state.promptMessageId !== null) {
            await ctx.api
              .deleteMessage(ctx.chat!.id, state.promptMessageId)
              .catch(() => {});
          }
          await ctx.reply(REPLY_SENT);
        } catch (e) {
          logger.warn(
            { err: e, botId: state.botId },
            "forwarding owner reply failed",
          );
          await ctx.reply(REPLY_FAILED_GENERIC);
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
