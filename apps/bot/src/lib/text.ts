/**
 * Single source of truth for every user-facing string emitted by the
 * onboarding bot and the tenant bots. Pulling these out of the handler
 * files lets us tweak wording, add i18n later, and keep the handlers
 * focused on flow logic instead of copywriting.
 *
 * Conventions:
 * - Constants: `UPPER_SNAKE_CASE` for static strings with no variables.
 * - Functions: `camelCase(...)` for messages that interpolate dynamic
 *   values; these stay typed so callers don't pass the wrong shape.
 * - HTML vs plain text: any string intended to be sent with
 *   `parse_mode: "HTML"` makes its formatting explicit in the literal
 *   (e.g. `<b>`/`<code>`). Anything not marked HTML is sent verbatim.
 */

// =============================================================================
// Common toasts (callback query answers)
// =============================================================================

export const TOAST_STALE_CALLBACK = "That button expired. Reopened the menu.";
export const TOAST_BOT_NOT_LOADED =
  "Bot isn't loaded yet. Try again in a moment.";
export const TOAST_PERMISSIONS_REFRESHED = "Permissions refreshed.";
export const TOAST_PERMISSIONS_FETCH_FAILED =
  "Couldn't reach Telegram. Try again in a moment.";
export const TOAST_REFRESH_RATE_LIMITED =
  "Already up to date — try again in a moment.";
export const TOAST_NO_BUSINESS_CONNECTION =
  "Bot isn't connected to your Business account yet.";
export const TOAST_REPLY_EXPIRED = "This reply has expired.";
export const TOAST_TAP_TRASH_TO_DELETE =
  "Tap the bin icon to delete this document.";
export const TOAST_AUTOREAD_ON =
  "Auto-read on. Customer messages will show as read.";
export const TOAST_AUTOREAD_OFF =
  "Auto-read off. Customer messages stay unread until you open them.";

// =============================================================================
// Common UI
// =============================================================================

export const MAIN_MENU_TITLE = "Main menu";

/**
 * Formal welcome shown on `/start` of the onboarding bot. Renders as
 * HTML; the caller sends with `parse_mode: "HTML"`.
 *
 * Same text for first-time and returning owners — addressing the owner
 * by first name when Telegram exposes it keeps it personal without
 * needing to look up whether they've onboarded before.
 */
export function onboardingWelcome(firstName: string | null): string {
  const greeting = firstName?.trim()
    ? `👋 Welcome, ${firstName.trim()}`
    : "👋 Welcome";
  return (
    `<b>${greeting}</b>\n\n` +
    "This is your control panel for AI-powered customer support on " +
    "Telegram Business. Connect a bot, upload your documentation, and " +
    "it will answer customers from your knowledge base 24/7 — while " +
    "you stay in control of every reply.\n\n" +
    "Choose an option below to get started."
  );
}

/**
 * /help for the onboarding bot. Renders as HTML; the caller sends with
 * `parse_mode: "HTML"`. Describes the surfaces the owner can use here
 * (creating bots, managing them, billing) — does NOT cover the tenant
 * bot's per-bot management menu, which has its own /help.
 */
export const ONBOARDING_HELP =
  "<b>How this works</b>\n\n" +
  "This is your control panel. Each bot you connect runs AI-powered " +
  "support on your Telegram Business account, answers from your uploaded " +
  "documentation, and escalates to you when it can't.\n\n" +
  "<b>Setting up a bot</b>\n" +
  "1. Create a bot via @BotFather and enable <i>Business Mode</i> in its " +
  "settings.\n" +
  "2. Tap <b>🤖 New bot</b> and paste the token.\n" +
  "3. Open Telegram → <i>Settings → Business → Chatbots</i>, add your bot, " +
  "and grant at least <i>Reply to messages</i> (Read messages recommended).\n" +
  "4. Once connected, open the bot directly and tap <b>/start</b> to manage " +
  "its prompt, welcome message, knowledge base, and limits.\n\n" +
  "<b>Buttons here</b>\n" +
  "• <b>🤖 New bot</b> — connect another bot to this account.\n" +
  "• <b>⚙️ Your bots</b> — list, pause, resume, or delete connected bots.\n" +
  "• <b>💳 Billing</b> — view your plan, usage, and Stars subscription.\n\n" +
  "<b>Commands</b>\n" +
  "• <code>/start</code> — main menu.\n" +
  "• <code>/billing</code> — open the billing screen.\n" +
  "• <code>/help</code> — this message.";

/**
 * /help for a tenant bot, shown to the owner only. Renders as HTML.
 * `username` is the bot's @username so the message reads naturally.
 */
export function tenantHelp(args: { username: string }): string {
  return (
    `<b>Managing @${escapeHtml(args.username)}</b>\n\n` +
    "Use <b>/start</b> here at any time to open the management menu.\n\n" +
    "<b>What each option does</b>\n" +
    "• <b>✏️ Prompt</b> — the system prompt that tells the AI how to behave. " +
    "Use <code>{business_name}</code> as a placeholder for your tenant name.\n" +
    "• <b>💬 Welcome</b> — a custom greeting shown when a customer opens " +
    "this bot for the first time.\n" +
    "• <b>📚 Knowledge</b> — documents (PDF, TXT, Markdown, DOCX, HTML) " +
    "the bot can search to ground its answers.\n" +
    "• <b>🎯 Daily limit</b> — per-customer daily ceiling on AI replies. " +
    "Past the limit, the customer gets your busy reply instead of an AI " +
    "answer. Tap <b>✉️ Edit busy reply</b> inside this screen to customize " +
    "that message.\n" +
    "• <b>👁 Auto-read</b> — toggle whether the bot marks incoming customer " +
    "messages as read automatically.\n" +
    "• <b>🔒 Permissions</b> — check what your Business connection has " +
    "granted the bot.\n\n" +
    "<b>Replying to a customer yourself</b>\n" +
    "When the AI escalates, you'll get a message with a <b>✏️ Reply</b> " +
    "button. Tap it, send your message in any format (text, photo, voice, " +
    "etc.), and the customer receives an exact copy.\n\n" +
    "<b>Commands</b>\n" +
    "• <code>/start</code> — open the management menu.\n" +
    "• <code>/help</code> — this message."
  );
}

export const BOT_NOT_FOUND = "Bot not found. It may have been deleted.";
export const SEND_TEXT_PLEASE = "Send a text message, or press Cancel.";

/**
 * Truncate a string to at most `max` visible characters, replacing the
 * tail with a single ellipsis when truncated. Total length stays within
 * `max`. Use for keyboard button labels where Telegram clips silently.
 */
export function truncateMid(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

// =============================================================================
// Onboarding bot — main flow + bot list
// =============================================================================

export const ONBOARDING_BOT_LIST_EMPTY =
  "No bots yet. Create your first one below.";
export const ONBOARDING_BOT_LIST_HEADER = "Your bots";
export const ONBOARDING_BOT_LIST_AFTER_DELETE_EMPTY =
  "Bot deleted. No bots left — create a new one below.";
export const ONBOARDING_BOT_LIST_AFTER_DELETE_HEADER =
  "✅ Bot deleted.\n\nYour bots";

export const ONBOARDING_CREATE_PROMPT =
  "<b>Connect a bot</b>\n\n" +
  "Follow these steps in Telegram. You can keep this chat open in a " +
  "second window or come back when you're done.\n\n" +
  "<b>1. Create a bot in @BotFather</b>\n" +
  "Open @BotFather, send <code>/newbot</code>, then pick a display name " +
  "and a username (must end in <code>bot</code>). BotFather replies with " +
  "your bot token — it looks like <code>123456789:AAExxxxxxxxxxxxxxxxxx</code>.\n\n" +
  "<b>2. Enable Business Mode for the bot</b>\n" +
  "Still in @BotFather, send <code>/mybots</code> → pick your new bot → " +
  "<i>Bot Settings</i> → <i>Business Mode</i> → tap <i>Turn on</i>.\n\n" +
  "<b>3. Paste the token here</b>\n" +
  "Copy the full token from @BotFather and send it as a message in this " +
  "chat. I'll verify it with Telegram and connect it.\n\n" +
  "After connecting, I'll walk you through the last step: linking the " +
  "bot to your Telegram Business account so it can read and reply for " +
  "you.\n\n" +
  "🔒 <b>Keep the token private.</b> Anyone with it can fully control " +
  "your bot. Don't share it outside this chat. If it leaks, revoke it " +
  "with <code>/revoke</code> in @BotFather.";

export const ONBOARDING_TOKEN_REQUIRED =
  "Send a valid bot token, or press Cancel.";
export const ONBOARDING_INVALID_TOKEN =
  "That token isn't valid. Send a token from @BotFather, or press Cancel.";

export function onboardingBotConnected(username: string): string {
  return (
    `✅ Bot @${username} connected!\n\n` +
    "Next: open Telegram → Settings → Business → Chatbots, " +
    `add @${username}, and grant at least these permissions:\n` +
    "• Reply to messages (required)\n" +
    "• Read messages (recommended)"
  );
}

export function onboardingBotStatusLine(
  username: string,
  statusIcon: string,
): string {
  return `🤖 @${username}\nStatus: ${statusIcon}`;
}

export function onboardingDeleteFailed(errMsg: string): string {
  return `Delete failed: ${errMsg}`;
}

// =============================================================================
// Delete-bot confirmation
// =============================================================================

/** Exact phrase the owner must type to confirm a bot deletion. */
export const DELETE_CONFIRM_PHRASE = "Yes, I am totally sure.";

export function deleteBotPrompt(phrase: string): string {
  return (
    "⚠️ This permanently deletes the bot and all associated data.\n\n" +
    `To confirm, reply with exactly:\n\n<code>${phrase}</code>\n\n` +
    "Or press Cancel."
  );
}

export function deleteBotMismatch(phrase: string): string {
  return (
    "That doesn't match. Reply with exactly:\n\n" +
    `<code>${phrase}</code>\n\nOr press Cancel.`
  );
}

// =============================================================================
// Tenant bot — owner management menu
// =============================================================================

/**
 * Tenant-bot management menu header. Renders as HTML; the caller sends
 * with `parse_mode: "HTML"`.
 *
 * `firstName` personalizes the greeting when Telegram exposes it. The
 * caller resolves at-a-glance state (connection, knowledge-base size)
 * cheaply and passes it in; we don't echo the system prompt here —
 * owners already wrote it and don't need to re-read it every visit.
 */
export function managementMenu(args: {
  username: string;
  statusIcon: string;
  connectionLinked: boolean;
  documentCount: number;
  firstName?: string | null;
}): string {
  const { username, statusIcon, connectionLinked, documentCount, firstName } =
    args;
  const greeting = firstName?.trim()
    ? `👋 <b>Hi ${escapeHtml(firstName.trim())}</b>\n\n`
    : "";
  const connectionLine = connectionLinked
    ? "Connection: ✅ Linked"
    : "Connection: ⏳ Not linked yet";
  const docWord = documentCount === 1 ? "document" : "documents";
  return (
    `${greeting}` +
    `Managing <b>@${escapeHtml(username)}</b>\n\n` +
    `Status: ${statusIcon}\n` +
    `${connectionLine}\n` +
    `Knowledge: ${documentCount} ${docWord}`
  );
}

/** Minimal HTML escape for the four characters Telegram parses. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// =============================================================================
// Per-end-user daily AI reply cap editor
// =============================================================================

export function dailyCapButtonLabel(value: number | null): string {
  return `🎯 Daily limit: ${value === null ? "Off" : String(value)}`;
}

export function dailyCapEditorBody(args: {
  currentValue: number | null;
  ceiling: number;
}): string {
  const current =
    args.currentValue === null
      ? "Off (unlimited up to your plan's monthly ceiling)"
      : String(args.currentValue);
  return (
    `🎯 Daily reply limit per customer\n\n` +
    `Current: ${current}\n` +
    `Plan ceiling: ${args.ceiling.toLocaleString("en-US")} per customer per day\n\n` +
    `Send a positive integer to set a limit, or tap "Set to Off" to remove it. ` +
    `If a customer hits the limit, the bot sends the busy reply instead of running the AI. ` +
    `Tap "Edit busy reply" to customize that message.`
  );
}

export function dailyCapInvalid(args: {
  reason: "not_an_integer" | "not_positive" | "exceeds_plan";
  ceiling: number;
}): string {
  if (args.reason === "not_an_integer") {
    return "Send a whole number, or press Cancel.";
  }
  if (args.reason === "not_positive") {
    return 'Send a positive whole number, or tap "Set to Off" / Cancel.';
  }
  return `That's above your plan's ceiling of ${args.ceiling.toLocaleString("en-US")} per customer per day. Try a smaller number, or press Cancel.`;
}

export function dailyCapUpdated(value: number | null): string {
  if (value === null) return "✅ Daily limit removed.";
  return `✅ Daily limit set to ${value} replies per customer per day.`;
}

// =============================================================================
// Per-end-user daily AI reply cap — owner-customizable "we're busy" reply
// =============================================================================

export const DAILY_CAP_MESSAGE_MAX_LENGTH = 1024;

export function dailyCapMessageEditorBody(args: {
  currentValue: string | null;
}): string {
  const current = args.currentValue?.trim()
    ? `Current:\n${args.currentValue}`
    : `Current: (using default)\n\nDefault:\n${DAILY_AI_CAP_REACHED_REPLY}`;
  return (
    `✉️ Busy reply\n\n` +
    `Sent to a customer once they've hit the daily limit.\n\n` +
    `${current}\n\n` +
    `Send the new message text (max ${DAILY_CAP_MESSAGE_MAX_LENGTH} chars), ` +
    `or tap "Use default" to clear your override.`
  );
}

export const DAILY_CAP_MESSAGE_TOO_LONG = `That's too long. Keep it under ${DAILY_CAP_MESSAGE_MAX_LENGTH} characters.`;

export const DAILY_CAP_MESSAGE_RESET = "✅ Busy reply reset to default.";

export function dailyCapMessageUpdated(value: string): string {
  const preview = value.length > 120 ? `${value.slice(0, 120)}…` : value;
  return `✅ Busy reply updated:\n\n${preview}`;
}

// =============================================================================
// Prompt editor
// =============================================================================

export function editPromptHeader(args: {
  username: string;
  prompt: string;
}): string {
  return `Current prompt for @${args.username}:\n\n${args.prompt}\n\nSend your new prompt, or press Cancel.`;
}

export const PROMPT_UPDATED = "✅ Prompt updated.";

// =============================================================================
// Welcome editor
// =============================================================================

export const WELCOME_NO_CUSTOM =
  "No custom welcome message — the default is shown to customers.";

export function welcomeCurrent(welcome: string): string {
  return `Current welcome message:\n\n${welcome}`;
}

export function welcomeEditorBody(current: string): string {
  return `${current}\n\nSend a new welcome message, or use the buttons below.`;
}

export const WELCOME_RESET = "✅ Welcome message reset to default.";
export const WELCOME_UPDATED = "✅ Welcome message updated.";

// =============================================================================
// Document manager
// =============================================================================

export function docListEmpty(args: { max: number; sizeLabel: string }): string {
  return `No documents yet. Add up to ${args.max} files, ${args.sizeLabel} each.`;
}

export function docListHeader(args: { count: number; max: number }): string {
  return `📚 ${args.count}/${args.max} documents`;
}

export function docConfirmDelete(fileName: string): string {
  return `Delete "${fileName}" and all its data?`;
}

export function docLimitReached(max: number): string {
  return `You've reached the ${max}-document limit. Delete one before adding another.`;
}

export function docAddPrompt(args: {
  sizeLabel: string;
  max: number;
}): string {
  return (
    `Send me a document to add as knowledge for this bot.\n\n` +
    `Supported: PDF, TXT, Markdown (.md), Word (.docx), HTML.\n\n` +
    `Max ${args.sizeLabel} per file, up to ${args.max} documents per bot.`
  );
}

export const DOC_UNSUPPORTED =
  "Please send a supported file (PDF, TXT, Markdown, DOCX, or HTML), or press Cancel.";

export function docTooLarge(args: { size: string; limit: string }): string {
  return `File is too large (${args.size}). Max ${args.limit} per file.`;
}

export const DOC_RAG_NOT_CONFIGURED =
  "Document processing is temporarily unavailable. Try again shortly.";
export const DOC_PROCESSING = "📥 Processing document…";
export const DOC_NO_FILE_ACCESS =
  "Couldn't access that file. Try sending it again.";

export function docIngestFailed(msg: string): string {
  return `Couldn't process that document. ${msg}`;
}

export const DOC_QUEUED = "✅ Document queued.";
export const DOC_DELETED = "✅ Document deleted.";
export const DOC_DELETE_FAILED = "Couldn't delete that document. Try again.";

// =============================================================================
// Permissions panel
// =============================================================================

export function permissionsPanel(formatted: string): string {
  return `🔒 Bot Permissions\n\n${formatted}`;
}

// =============================================================================
// Owner reply flow (admin → customer)
// =============================================================================

export const REPLY_CANCELLED =
  "Reply cancelled. Tap ✏️ Reply on the customer's message anytime to try again.";
export const REPLY_SENT = "✅ Sent to customer.";
export const REPLY_UNSUPPORTED_TYPE =
  "⚠️ I can't forward that type of message yet. Please send text, photo, voice, video, audio, document, sticker, animation (GIF), location, or contact.";

/**
 * Body of the "Send your reply" prompt. Rendered as HTML; the caller
 * prepends the customer-context line (`replyPromptContext`) when one is
 * available, then sends with parse_mode: "HTML".
 */
export const REPLY_PROMPT_BODY =
  "<b>Send your reply</b> — text, photo, voice, sticker, file, anything. The customer will receive an exact copy.\n\nOr tap Cancel.";

export function replyPromptContext(customerLabelHtml: string): string {
  return `Replying to ${customerLabelHtml}\n\n`;
}

export function replyFailedNoPermission(username: string): string {
  return `⚠️ The bot doesn't have permission to reply to customers. Open Telegram → Settings → Business → Chatbots → @${username} and grant 'Reply to messages'.`;
}

export const REPLY_FAILED_GENERIC =
  "⚠️ Couldn't send. Make sure the bot has Business Mode enabled in @BotFather and is added as admin to your Telegram Business account, with 'Reply to messages' granted.";

// =============================================================================
// Business connection alerts (to owner)
// =============================================================================

export function botConnectedAlert(args: {
  username: string;
  includesPermissionWarning: boolean;
}): string {
  const replyWarning = args.includesPermissionWarning
    ? "\n\n⚠️ Heads up: it doesn't have the 'Reply to messages' permission yet. Grant it under Settings → Business → Chatbots so the bot can actually answer customers."
    : "";
  return `✅ The bot @${args.username} is now connected to your Telegram Business account. It will reply to customers on your behalf.${replyWarning}`;
}

export function botDisconnectedAlert(username: string): string {
  return `⚠️ The bot @${username} was disconnected from your Telegram Business account. It won't reply to customers until you reconnect it under Telegram → Settings → Business → Chatbots.`;
}

// =============================================================================
// Missing can_reply pre-flight alert (HTML)
// =============================================================================

export function missingCanReplyAlert(args: {
  customerLabelHtml: string;
  username: string;
}): string {
  return `⚠️ ${args.customerLabelHtml} messaged @${args.username}, but the bot doesn't have permission to reply.\n\nOpen Telegram → Settings → Business → Chatbots → @${args.username} and grant <b>Reply to messages</b>.`;
}

// =============================================================================
// Customer reply delivery failure (sent to owner)
// =============================================================================

export function customerReplyFailedAlert(args: {
  customerLabel: string;
  question: string;
}): string {
  return `⚠️ Failed to reply to customer. Make sure the bot has Business Mode enabled in @BotFather and is added to your Telegram Business account and ensure it has the necessary permissions.\n\n${args.customerLabel}\n\nCustomer asked: ${args.question}`;
}

// =============================================================================
// Daily AI-reply cap reached for this end user (sent in business chat).
// Plain text, no HTML — keeps the reply broadly compatible.
// =============================================================================

export const DAILY_AI_CAP_REACHED_REPLY =
  "We're handling lots of other customers right now — I'll get back to you tomorrow. Thanks for your patience!";

// =============================================================================
// Admin escalation notification (HTML — both label and message are
// already HTML-safe by the caller; label via escapeHtml, message via
// markdownToTelegramHtml)
// =============================================================================

export function adminEscalation(args: {
  customerLabelHtml: string;
  messageHtml: string;
}): string {
  return `${args.customerLabelHtml}\n\n💬 ${args.messageHtml}`;
}

// =============================================================================
// Subscriptions — trial / lifecycle DMs
// =============================================================================

export const TRIAL_STARTED_DM =
  "🎫 Trial started — 14 days of full access. Subscribe anytime to lock in your plan.";

export const TRIAL_ENDING_7D_DM =
  "🎫 Trial ends in 7 days. Subscribe to keep your bots active.";

export const TRIAL_ENDING_1D_DM =
  "🎫 Trial ends in 1 day. Subscribe to keep your bots active.";

export const TRIAL_EXPIRED_DM =
  "🎫 Your trial has ended. Subscribe to reactivate your bots.";

export function subscriptionStartedDM(args: {
  planLabel: string;
  renewsOn: string;
}): string {
  return (
    `✅ <b>${args.planLabel}</b> active. Renews on ${args.renewsOn}.\n\n` +
    "Tip: manage auto-renew anytime via Telegram → Settings → Stars."
  );
}

export function subscriptionResumedDM(planLabel: string): string {
  return `✅ <b>${planLabel}</b> continues. Auto-renew is back on.`;
}

export function subscriptionCanceledDM(args: {
  planLabel: string;
  endsOn: string;
}): string {
  return `Cancelled. <b>${args.planLabel}</b> continues until ${args.endsOn}.`;
}

export function cancelEndingSoonDM(args: {
  planLabel: string;
  endsOn: string;
}): string {
  return (
    `Your <b>${args.planLabel}</b> ends in 3 days (${args.endsOn}). ` +
    "Resume or change plan below."
  );
}

export function subscriptionLapsedDM(args: {
  planLabel: string;
  bots: number;
}): string {
  const botWord = args.bots === 1 ? "bot" : "bots";
  return (
    `<b>${args.planLabel}</b> ended. ${args.bots} ${botWord} paused. ` +
    "Subscribe to reactivate."
  );
}

export function renewalFailedDM(bots: number): string {
  const botWord = bots === 1 ? "bot" : "bots";
  return `Renewal failed. ${bots} ${botWord} pause in 2 days unless you top up Stars.`;
}

export function quotaMessagesExceededDM(cap: number): string {
  return `You've hit ${cap.toLocaleString()} messages this period. Upgrade or wait until renewal.`;
}

export function pausedBotCustomerPingDM(botUsername: string): string {
  return `@${botUsername} got a message but is paused due to plan limits. Subscribe to reactivate.`;
}

// =============================================================================
// Subscriptions — /billing screen helpers
// =============================================================================

export function billingHeader(args: {
  status: "trialing" | "active" | "canceled" | "lapsed";
  planLabel: string;
  trialDaysLeft?: number | null;
  renewsOn?: string;
  endsOn?: string;
}): string {
  switch (args.status) {
    case "trialing": {
      // `trialDaysLeft = null` (or undefined) means the owner row exists
      // but trial_ends_at hasn't been set yet — they haven't created their
      // first bot. Show a pre-trial nudge instead of "0 days left".
      if (args.trialDaysLeft === null || args.trialDaysLeft === undefined) {
        return "🎫 14-day trial — create your first bot to start the clock";
      }
      const days = args.trialDaysLeft;
      const dayWord = days === 1 ? "day" : "days";
      return `🎫 Trial: ${days} ${dayWord} left`;
    }
    case "active": {
      const renews = args.renewsOn ?? "—";
      return `<b>${args.planLabel}</b> — active\nRenews on ${renews}`;
    }
    case "canceled": {
      const ends = args.endsOn ?? "—";
      return `<b>${args.planLabel}</b> — canceled\nEnds on ${ends}`;
    }
    case "lapsed":
      return "No active plan";
  }
}

export function billingUsageBlock(args: {
  bots: number;
  maxBots: number;
  docs: number;
  maxDocs: number;
  messages: number;
  maxMessages: number;
}): string {
  return (
    "Usage this period:\n" +
    `  Bots: ${args.bots}/${args.maxBots}\n` +
    `  Documents (all bots): ${args.docs}/${args.maxDocs}\n` +
    `  Messages: ${args.messages.toLocaleString()}/${args.maxMessages.toLocaleString()}`
  );
}

// =============================================================================
// Subscriptions — plan picker
// =============================================================================

export const PLAN_PICKER_HEADER = "⭐ Choose your plan";

export function planPickerLine(args: {
  planLabel: string;
  stars: number;
  maxBots: number;
  maxDocsPerBot: number;
  maxMessagesPerPeriod: number;
}): string {
  const botWord = args.maxBots === 1 ? "bot" : "bots";
  const msgs = formatThousands(args.maxMessagesPerPeriod);
  return (
    `<b>${args.planLabel}</b> — ${args.stars}⭐/mo\n` +
    `  ${args.maxBots} ${botWord}, ${args.maxDocsPerBot} docs/bot, ${msgs} msgs`
  );
}

/** Internal helper — compact thousands rendering (5000 → "5k"). */
function formatThousands(n: number): string {
  if (n >= 1000 && n % 1000 === 0) {
    return `${n / 1000}k`;
  }
  return n.toLocaleString();
}

// =============================================================================
// Subscriptions — cancel flow + reasons
// =============================================================================

export function cancelConfirmPrompt(args: {
  planLabel: string;
  endsOn: string;
}): string {
  return (
    `Are you sure you want to cancel? Your <b>${args.planLabel}</b> continues ` +
    `until ${args.endsOn}, then bots pause.`
  );
}

export const CANCEL_REASON_PROMPT = "Why are you canceling? (optional)";

export const CANCEL_REASONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "too_expensive", label: "Too expensive" },
  { key: "not_using", label: "Not using it" },
  { key: "switching_tools", label: "Switching tools" },
  { key: "other", label: "Other" },
];

// =============================================================================
// Subscriptions — upgrade Pro → Business
// =============================================================================

export function upgradeConfirmPrompt(args: {
  stars: number;
  endsOn: string;
}): string {
  return (
    `⭐ <b>Upgrade to Business</b> — ${args.stars} ⭐/mo\n\n` +
    `Your current Pro plan continues until ${args.endsOn} at no extra charge, ` +
    "alongside Business. After that, Business runs solo."
  );
}

// =============================================================================
// Subscriptions — gate / blocked messages
// =============================================================================

export function botCreateBlocked(args: {
  cap: number;
  planLabel: string;
}): string {
  const botWord = args.cap === 1 ? "bot" : "bots";
  return (
    `<b>${args.planLabel}</b> allows ${args.cap} ${botWord}. ` +
    "Delete an existing bot or upgrade to add another."
  );
}

export function docUploadBlocked(args: {
  cap: number;
  planLabel: string;
}): string {
  return (
    `Your <b>${args.planLabel}</b> only allows ${args.cap} docs per bot. ` +
    "Delete some or upgrade."
  );
}

export const SUBSCRIBE_TO_CREATE_BOT = "Subscribe to create a bot.";
export const SUBSCRIBE_TO_UPLOAD = "Subscribe to upload documents.";

// =============================================================================
// Subscriptions — toasts (callback query answers)
// =============================================================================

export const TOAST_REPLY_NOT_NOW = "Try again in a moment.";
export const TOAST_UPGRADE_IN_PROGRESS = "Processing your upgrade…";
export const TOAST_INVOICE_SENT = "Invoice sent — check the chat.";

// =============================================================================
// Subscriptions — banned notice (visible to banned owners in /billing)
// =============================================================================

export const BANNED_NOTICE =
  "Your account has been restricted. Contact support.";

// =============================================================================
// Subscriptions — admin command output snippets
// =============================================================================

export function adminOwnerSummary(args: {
  ownerId: string;
  username: string | null;
  plan: string | null;
  status: string;
  botCount: number;
  lifetimeStarsSpent: number;
}): string {
  const handle = args.username ? `@${args.username}` : "(no @username)";
  const plan = args.plan ?? "—";
  return (
    `<b>Owner</b> <code>${args.ownerId}</code> ${handle}\n` +
    `Plan: ${plan} (${args.status})\n` +
    `Bots: ${args.botCount}\n` +
    `Lifetime stars: ${args.lifetimeStarsSpent.toLocaleString()}⭐`
  );
}

export const ADMIN_REFUND_SUCCESS = "Refund issued + auto-renew canceled.";
export const ADMIN_COMP_GRANTED = "Complimentary subscription granted.";
export const ADMIN_BAN_APPLIED =
  "Owner banned; subscriptions canceled; bots paused.";
export const ADMIN_UNBAN_APPLIED = "Owner unbanned.";
export const ADMIN_OWNER_NOT_FOUND = "Owner not found.";
export const ADMIN_UNAUTHORIZED = "Not authorized.";
