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

export const TOAST_STALE_CALLBACK = "Callback query old";
export const TOAST_BOT_NOT_LOADED = "Bot not loaded.";
export const TOAST_PERMISSIONS_REFRESHED = "Permissions refreshed.";
export const TOAST_PERMISSIONS_FETCH_FAILED =
  "Couldn't reach Telegram. Try again in a moment.";
export const TOAST_REFRESH_RATE_LIMITED =
  "Already up to date — try again in a moment.";
export const TOAST_NO_BUSINESS_CONNECTION = "No business connection yet.";
export const TOAST_REPLY_EXPIRED =
  "This reply window expired or was already used.";
export const TOAST_TAP_TRASH_TO_DELETE = "Tap 🗑️ to delete this document.";
export const TOAST_AUTOREAD_ON =
  "Auto-read enabled — customer messages will show as read.";
export const TOAST_AUTOREAD_OFF =
  "Auto-read disabled — customer messages stay unread until you open them.";

// =============================================================================
// Common UI
// =============================================================================

export const MAIN_MENU_TITLE = "Main menu:";
export const BOT_NOT_FOUND = "Bot not found.";
export const SEND_TEXT_PLEASE = "Please send a text message.";

// =============================================================================
// Onboarding bot — main flow + bot list
// =============================================================================

export const ONBOARDING_BOT_LIST_EMPTY = "No bots yet. Create one below:";
export const ONBOARDING_BOT_LIST_HEADER = "Your bots:";
export const ONBOARDING_BOT_LIST_AFTER_DELETE_EMPTY =
  "No bots left. Create one below:";
export const ONBOARDING_BOT_LIST_AFTER_DELETE_HEADER =
  "✅ Bot deleted. Your bots:";

export const ONBOARDING_CREATE_PROMPT =
  "Send me your bot token.\n\n" +
  "1. Create a bot via @BotFather\n" +
  "2. Enable Business Mode in BotFather settings\n" +
  "3. Paste the token here";

export const ONBOARDING_TOKEN_REQUIRED =
  "Please send a valid bot token, or press Cancel.";
export const ONBOARDING_INVALID_TOKEN =
  "Invalid token. Send me a valid bot token, or press Cancel.";

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
    "❌ That doesn't match. Reply with exactly:\n\n" +
    `<code>${phrase}</code>\n\nOr press Cancel.`
  );
}

// =============================================================================
// Tenant bot — owner management menu
// =============================================================================

export function managementMenu(args: {
  username: string;
  statusIcon: string;
  systemPrompt: string;
}): string {
  const { username, statusIcon, systemPrompt } = args;
  const preview = systemPrompt.slice(0, 200);
  const ellipsis = systemPrompt.length > 200 ? "..." : "";
  return `⚙️ @${username} Management\n\nStatus: ${statusIcon}\n\nPrompt preview:\n${preview}${ellipsis}`;
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

export const PROMPT_UPDATED = "✅ Prompt updated!";

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
export const WELCOME_UPDATED = "✅ Welcome message updated!";

// =============================================================================
// Document manager
// =============================================================================

export function docListEmpty(args: { max: number; sizeLabel: string }): string {
  return `No documents yet. (Up to ${args.max}, ${args.sizeLabel} each.)`;
}

export function docListHeader(args: { count: number; max: number }): string {
  return `📚 ${args.count}/${args.max} documents`;
}

export function docConfirmDelete(fileName: string): string {
  return `Delete "${fileName}" and all its data?`;
}

export function docLimitReached(max: number): string {
  return `❌ You've reached the ${max}-document limit. Delete one before adding another.`;
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
  return `❌ File is too large (${args.size}). Max ${args.limit} per file.`;
}

export const DOC_RAG_NOT_CONFIGURED = "RAG worker not configured.";
export const DOC_PROCESSING = "📥 Processing document…";
export const DOC_NO_FILE_ACCESS = "Could not access the file.";

export function docIngestFailed(msg: string): string {
  return `❌ Failed to process document: ${msg}`;
}

export const DOC_QUEUED = "✅ Document queued for processing!";
export const DOC_DELETED = "✅ Document deleted.";
export const DOC_DELETE_FAILED = "❌ Failed to delete.";

// =============================================================================
// Permissions panel
// =============================================================================

export function permissionsPanel(formatted: string): string {
  return `🔒 Bot Permissions\n\n${formatted}`;
}

// =============================================================================
// Owner reply flow (admin → customer)
// =============================================================================

export const REPLY_CANCELLED = "Reply cancelled.";
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
    `🚫 <b>${args.planLabel}</b> ended. ${args.bots} ${botWord} paused. ` +
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
  trialDaysLeft?: number;
  renewsOn?: string;
  endsOn?: string;
}): string {
  switch (args.status) {
    case "trialing": {
      const days = args.trialDaysLeft ?? 0;
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
      return "🚫 No active plan";
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
    `  Documents (largest bot): ${args.docs}/${args.maxDocs}\n` +
    `  Messages: ${args.messages.toLocaleString()}/${args.maxMessages.toLocaleString()}`
  );
}

// =============================================================================
// Subscriptions — plan picker
// =============================================================================

export const PLAN_PICKER_HEADER = "⭐ Choose your plan:";

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

export const SUBSCRIBE_TO_CREATE_BOT = "🚫 Subscribe to create a bot.";
export const SUBSCRIBE_TO_UPLOAD = "🚫 Subscribe to upload documents.";

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
