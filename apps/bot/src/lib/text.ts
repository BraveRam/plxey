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

import { PLANS } from "./plans";

// =============================================================================
// Common toasts (callback query answers)
// =============================================================================

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

/**
 * Sent to a customer who sends an image with no caption to a bot whose owner
 * is not on the business plan (image understanding is business-tier only).
 */
export const IMAGE_UNSUPPORTED_REPLY =
  "Sorry, I can't view images here — please describe your question in text and I'll help.";

// =============================================================================
// Restart (re-validate token + re-set webhook)
// =============================================================================

/**
 * Owner-facing error for a failed bot restart. The `reason` values mirror
 * `restartBot`'s result union in `lib/api.ts`:
 *   - `token_invalid` — getMe failed; the token was likely revoked in
 *     BotFather. Actionable: re-add the bot with a fresh token.
 *   - `not_configured` — server-side misconfig (e.g. missing PUBLIC_URL).
 *     Don't leak the internal detail; just ask the owner to retry.
 *   - `webhook_failed` — Telegram rejected setWebhook after retries.
 *   - `rate_limited` — restart tapped again too soon (per-bot throttle).
 */
export function restartErrorMessage(
  reason: "token_invalid" | "not_configured" | "webhook_failed" | "rate_limited",
): string {
  switch (reason) {
    case "token_invalid":
      return (
        "Couldn't reach this bot — its token may have been revoked in " +
        "BotFather. Delete it here and add it again with a fresh token."
      );
    case "not_configured":
      return "Couldn't restart the bot right now. Please try again in a moment.";
    case "webhook_failed":
      return "Couldn't reach Telegram to restart the bot. Try again in a moment.";
    case "rate_limited":
      return "Just restarted — wait a few seconds before trying again.";
  }
}

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
  "documentation, and escalates to you when it can't. On the " +
  "<b>Business</b> plan, your bot can also answer photos customers send.\n\n" +
  "<b>Setting up a bot</b>\n" +
  "1. Create a bot via @BotFather and enable <i>Business Mode</i> in its " +
  "settings.\n" +
  "2. Tap <b>🤖 New bot</b> and paste the token.\n" +
  "3. Open Telegram → <i>Settings → Profile → Chat Automation</i>, add your bot, " +
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
  "• <code>/help</code> — this message.\n" +
  "• <code>/privacy</code> — privacy policy.\n" +
  "• <code>/terms</code> — terms of service.";

/**
 * /help for a tenant bot, shown to the owner only. Renders as HTML.
 * No username in the body — the owner is chatting with this bot
 * already.
 */
export function tenantHelp(): string {
  return (
    `<b>Bot help</b>\n\n` +
    "Use <b>/start</b> here at any time to open the management menu.\n\n" +
    "<b>What each option does</b>\n" +
    "• <b>✏️ Prompt</b> — the system prompt that tells the AI how to behave. " +
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
    "granted the bot.\n" +
    "• <b>📊 Analytics</b> — see how many customers talked to this bot " +
    "today and over the last week and month.\n\n" +
    "<b>Photos (Business plan)</b>\n" +
    "On the Business plan, customers can send your bot a photo and it " +
    "answers about the image. On other plans the bot replies in text and " +
    "asks the customer to describe their question.\n\n" +
    "<b>Replying to a customer yourself</b>\n" +
    "When the AI escalates, you'll get a message with a <b>✏️ Reply</b> " +
    "button. Tap it, send your message in any format (text, photo, voice, " +
    "etc.), and the customer receives an exact copy.\n\n" +
    "<b>Commands</b>\n" +
    "• <code>/start</code> — open the management menu.\n" +
    "• <code>/help</code> — this message."
  );
}

/**
 * Privacy policy shown by `/privacy` on the onboarding bot. Plain
 * owner-friendly language — no internal infra names. Reviewable copy
 * lives here so we can iterate without redeploying anything else.
 */
export const PRIVACY_POLICY =
  "<b>Privacy policy</b>\n\n" +
  "Short version: we only use your data to run the bot service you " +
  "signed up for. We don't sell it, we don't share it for advertising, " +
  "and you can delete it any time.\n\n" +
  "<b>What we know about you</b>\n" +
  "• Your Telegram profile: name, username, language - basic info " +
  "• The bots you connect, including the bot token (stored encrypted).\n" +
  "• Messages your customers send to your bots, and the replies the " +
  "AI generates.\n" +
  "• Documents you upload as knowledge for your bots.\n" +
  "• Your subscription history and payments (handled by Telegram Stars).\n\n" +
  "<b>What we use it for</b>\n" +
  "• Powering the AI replies your bots send to your customers.\n" +
  "• Showing you usage stats and billing information.\n" +
  "• Improving the service (we look at anonymized product " +
  "analytics).\n\n" +
  "<b>Who we share it with</b>\n" +
  "We never sell or rent your data. We work with a small set of " +
  "trusted infrastructure providers (cloud hosting, database, file " +
  "storage, AI model providers, payment processing through Telegram). " +
  "They only see what they need to do their job, and they're bound by " +
  "their own privacy commitments.\n\n" +
  "<b>How long we keep it</b>\n" +
  "• While your account exists: as long as you keep your bots " +
  "connected.\n" +
  "• After you delete a bot: customer messages tied to it are removed.\n" +
  "• Payment records: kept for accounting purposes.\n\n" +
  "<b>Your choices</b>\n" +
  "• You can delete any bot from the onboarding menu at any time.\n" +
  "• You can ask us to delete your entire account by messaging the " +
  "contact below.\n" +
  "• You can cancel your subscription from /billing.\n\n" +
  "<b>Questions or requests</b>\n" +
  "Message us via Telegram support — see /help. We respond within a " +
  "few business days.";

/**
 * Terms of service shown by `/terms` on the onboarding bot. Plain
 * language. Not legal advice; an owner should consult a lawyer for
 * jurisdiction-specific compliance, but this sets a baseline that
 * matches what the product actually does.
 */
export const TERMS_OF_SERVICE =
  "<b>Terms of service</b>\n\n" +
  "By using this service you agree to the rules below. Please read " +
  "them — they're short.\n\n" +
  "<b>What you get</b>\n" +
  "AI-powered customer support that runs on your Telegram Business " +
  "account. You connect a bot, upload documents it can use as " +
  "knowledge, and it replies to your customers on your behalf.\n\n" +
  "<b>Subscription and payments</b>\n" +
  "• You start on a free trial. After that you pick a paid plan if " +
  "you want to keep going.\n" +
  "• Payments are made with Telegram Stars and renew every 30 days " +
  "until you cancel.\n" +
  "• You can cancel any time from /billing. Your plan continues " +
  "through the end of the period you already paid for.\n" +
  "• Refunds are at our discretion and subject to Telegram's rules " +
  "for Stars.\n\n" +
  "<b>What you can and can't do</b>\n" +
  "• You're responsible for what your bots say and do.\n" +
  "• No illegal content, spam, harassment, or anything that breaks " +
  "Telegram's own terms.\n" +
  "• If you break these rules we can suspend or close your account.\n\n" +
  "<b>About the AI replies</b>\n" +
  "The AI generates answers based on the documents and instructions " +
  "you give it. It can be wrong. Treat its replies as a draft your " +
  "customers will see — you're the one who decides what your bot " +
  "should know and how it should behave.\n\n" +
  '<b>Service is "as is"</b>\n' +
  "We do our best to keep things running, but we don't promise the " +
  "service will be available without interruption or free of bugs. " +
  "To the extent the law allows, our liability is limited to the " +
  "fees you paid in the past 30 days.\n\n" +
  "<b>Changes to these terms</b>\n" +
  "If we update these terms in a meaningful way we'll let you know " +
  "via the onboarding bot. Continuing to use the service after a " +
  "change means you accept the new terms.\n\n" +
  "<b>Questions</b>\n" +
  "Message us via Telegram support — see /help.";

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
    "Next: open Telegram → Settings → Profile → Chat Automation, " +
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
 * `firstName` personalizes the greeting when Telegram exposes it.
 * Connection state is resolved from the in-memory BotEntry; we don't
 * echo the system prompt here — owners already wrote it and don't
 * need to re-read it every visit. We deliberately don't run an extra
 * COUNT(*) for the knowledge-base size on the hot /start path —
 * owners can open the 📚 Knowledge button to see the doc list.
 */
export function managementMenu(args: {
  statusIcon: string;
  connectionLinked: boolean;
  firstName?: string | null;
}): string {
  const { statusIcon, connectionLinked, firstName } = args;
  const greeting = firstName?.trim()
    ? `👋 <b>Hi ${escapeHtml(firstName.trim())}</b>\n\n`
    : "";
  const connectionLine = connectionLinked
    ? "Connection: ✅ Linked"
    : "Connection: ⏳ Not linked yet";
  return (
    `${greeting}` +
    `<b>Manage your bot</b>\n\n` +
    `Status: ${statusIcon}\n` +
    `${connectionLine}`
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

export function editPromptHeader(args: { prompt: string }): string {
  // The prompt is owner-authored free text shown in a parse_mode:"HTML"
  // message. Escape it — an unescaped `<`/`&` makes Telegram reject the
  // send (400 "can't parse entities"), and since the caller deletes the
  // menu before sending this, a failed send leaves a dead, empty screen.
  return `<b>Current prompt</b>\n\n${escapeHtml(args.prompt)}\n\nSend your new prompt, or press Cancel.`;
}

export const PROMPT_UPDATED = "✅ Prompt updated.";

// =============================================================================
// Owner-facing 📊 Analytics screen
// =============================================================================

export const ANALYTICS_EMPTY_HINT =
  "No customer activity yet. Once customers start messaging your bot, " +
  "their numbers will show up here.";

interface AnalyticsScreenBucket {
  received: number;
  answered: number;
  customers: number;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatRelativeAgo(when: Date, now: Date = new Date()): string {
  const diffMs = Math.max(0, now.getTime() - when.getTime());
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

function formatBucket(b: AnalyticsScreenBucket): string {
  return (
    `  Messages received:  ${formatNumber(b.received)}\n` +
    `  AI replies sent:    ${formatNumber(b.answered)}\n` +
    `  Unique customers:   ${formatNumber(b.customers)}`
  );
}

export type AnalyticsWindow = "today" | "last7d" | "last30d";

export function analyticsWindowLabel(window: AnalyticsWindow): string {
  switch (window) {
    case "today":
      return "Today";
    case "last7d":
      return "Last 7 days";
    case "last30d":
      return "Last 30 days";
  }
}

/**
 * Top-level Analytics landing card. The owner taps it from the
 * management menu; we show a short prompt and three window-pick
 * buttons (rendered by the caller). When the bot has never seen
 * a customer message, we show the empty hint instead.
 */
export function analyticsLanding(args: { hasAnyActivity: boolean }): string {
  const header = `📊 <b>Analytics</b>`;
  if (!args.hasAnyActivity) {
    return `${header}\n\n${ANALYTICS_EMPTY_HINT}`;
  }
  return (
    `${header}\n\n` +
    "Pick a window to see how many customers messaged you, how " +
    "many the AI replied to, and how many of those were unique people."
  );
}

/**
 * Per-window drill-in card. Owner taps Today / Last 7 days /
 * Last 30 days from the landing card or from another drill-in
 * (the three buttons stay visible so they can switch quickly).
 */
export function analyticsBucketScreen(args: {
  window: AnalyticsWindow;
  bucket: AnalyticsScreenBucket;
  lastMessageAt: Date | null;
  now?: Date;
}): string {
  const windowLabel = analyticsWindowLabel(args.window);
  const header = `📊 <b>${windowLabel}</b>`;
  const lastLine = args.lastMessageAt
    ? `Last message: ${formatRelativeAgo(args.lastMessageAt, args.now)}`
    : "Last message: —";
  return `${header}\n\n` + `${formatBucket(args.bucket)}\n\n` + lastLine;
}

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

export function docAddPrompt(args: { sizeLabel: string; max: number }): string {
  return (
    `Send me one or more documents to add as knowledge for this bot.\n\n` +
    `Supported: PDF, TXT, Markdown (.md), Word (.docx), HTML.\n\n` +
    `Max ${args.sizeLabel} per file, up to ${args.max} documents per bot.\n\n` +
    `Send /done when you're finished.`
  );
}

export const DOC_BATCH_PROMPT = "Send another document or press /done.";

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
  return `⚠️ The bot doesn't have permission to reply to customers. Open Telegram → Settings → Profile → Chat Automation → @${username} and grant 'Reply to messages'.`;
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
    ? "\n\n⚠️ Heads up: it doesn't have the 'Reply to messages' permission yet. Grant it under Settings → Profile → Chat Automation so the bot can actually answer customers."
    : "";
  return `✅ The bot @${args.username} is now connected to your Telegram Business account. It will reply to customers on your behalf.${replyWarning}`;
}

export function botDisconnectedAlert(username: string): string {
  return `⚠️ The bot @${username} was disconnected from your Telegram Business account. It won't reply to customers until you reconnect it under Telegram → Settings → Profile → Chat Automation.`;
}

// =============================================================================
// Missing can_reply pre-flight alert (HTML)
// =============================================================================

export function missingCanReplyAlert(args: {
  customerLabelHtml: string;
  username: string;
}): string {
  return `⚠️ ${args.customerLabelHtml} messaged @${args.username}, but the bot doesn't have permission to reply.\n\nOpen Telegram → Settings → Profile → Chat Automation → @${args.username} and grant <b>Reply to messages</b>.`;
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

/**
 * Compact comparison line for plan tiers. Derives stars + caps from the
 * single PLANS config so a repricing edits only one place. Used by every
 * trial / lapsed / quota DM to give the owner enough context to pick a tier
 * without leaving the chat.
 */
export function pricingLine(): string {
  const pro = PLANS.pro;
  const business = PLANS.business;
  const fmt = (n: number) => formatThousands(n);
  return (
    `<b>Pro</b> · ${pro.starsPerPeriod}⭐/mo · ${pro.maxBots} bots · ${fmt(pro.maxMessagesPerPeriod)} msgs\n` +
    `<b>Business</b> · ${business.starsPerPeriod}⭐/mo · ${business.maxBots} bots · ${fmt(business.maxMessagesPerPeriod)} msgs`
  );
}

export function trialStartedDM(): string {
  return (
    "🎫 <b>Trial started</b> — 7 days of full access.\n" +
    "If you don't subscribe before it ends, your bots pause and customers won't get replies.\n\n" +
    pricingLine()
  );
}

export function trialEnding3dDM(): string {
  return (
    "🎫 <b>Trial ends in 3 days.</b> Subscribe now to keep your bots answering.\n\n" +
    pricingLine()
  );
}

export function trialEnding1dDM(): string {
  return (
    "🎫 <b>Trial ends tomorrow.</b> Subscribe today so your bots don't go quiet.\n\n" +
    pricingLine()
  );
}

export function trialExpiredDM(): string {
  return (
    "🎫 <b>Your trial has ended.</b> Your bots are paused — customers reaching them get no reply. " +
    "Subscribe to reactivate instantly.\n\n" +
    pricingLine()
  );
}

export function subscriptionStartedDM(args: {
  planLabel: string;
  renewsOn: string;
}): string {
  return (
    `✅ <b>${args.planLabel}</b> active. Renews on ${args.renewsOn}.\n\n` +
    "Manage your bots, docs, and usage anytime in the Mini App."
  );
}

export function subscriptionResumedDM(planLabel: string): string {
  return `✅ <b>${planLabel}</b> continues. Auto-renew is back on.`;
}

export function subscriptionCanceledDM(args: {
  planLabel: string;
  endsOn: string;
}): string {
  return (
    `Cancelled. <b>${args.planLabel}</b> continues until ${args.endsOn}, then bots pause.\n\n` +
    "Changed your mind? Tap below to resume — no charge until your current period ends."
  );
}

export function cancelEndingSoonDM(args: {
  planLabel: string;
  endsOn: string;
}): string {
  return (
    `Your <b>${args.planLabel}</b> ends in 3 days (${args.endsOn}). ` +
    "Tap below to resume before your bots pause."
  );
}

export function subscriptionLapsedDM(args: {
  planLabel: string;
  bots: number;
}): string {
  const botWord = args.bots === 1 ? "bot" : "bots";
  return (
    `<b>${args.planLabel}</b> ended. ${args.bots} ${botWord} paused — incoming customer messages get no AI reply.\n\n` +
    "Subscribe to reactivate.\n\n" +
    pricingLine()
  );
}

export function renewalFailedDM(bots: number): string {
  const botWord = bots === 1 ? "bot" : "bots";
  return (
    `Renewal failed — not enough Stars. ${bots} ${botWord} pause in 2 days unless you top up.\n\n` +
    "Top up Stars in Telegram (Settings → Stars), then tap below to retry."
  );
}

export function quotaMessagesExceededDM(args: {
  cap: number;
  planLabel: string;
}): string {
  return (
    `📈 You've hit ${args.cap.toLocaleString()} messages on <b>${args.planLabel}</b> this period.\n\n` +
    "Upgrade to keep answering now, or wait until your next renewal.\n\n" +
    pricingLine()
  );
}

export function pausedBotCustomerPingDM(botUsername: string): string {
  return (
    `👤 A customer just messaged <b>@${botUsername}</b>, but it's paused due to plan limits.\n\n` +
    "Tap below to reactivate and let your AI take it from here."
  );
}

export function recoveryT3DM(args: { docs: number }): string {
  const docsLine =
    args.docs > 0
      ? `Your ${args.docs} document${args.docs === 1 ? "" : "s"} are still here. `
      : "";
  return (
    `👋 We miss you. ${docsLine}Resubscribe to bring your bots back online.\n\n` +
    pricingLine()
  );
}

export function recoveryT14DM(): string {
  return (
    "⏳ It's been two weeks since your subscription ended. Your bots are still paused and " +
    "customers reaching them get no reply.\n\n" +
    "Reactivate anytime — your docs and settings are still saved.\n\n" +
    pricingLine()
  );
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
        return "🎫 7-day trial — create your first bot to start the clock";
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
export const ADMIN_COMP_REVOKED =
  "Complimentary subscription(s) revoked; effective plan recomputed.";
export const ADMIN_COMP_NONE = "No complimentary subscription found for that owner.";
export const ADMIN_BAN_APPLIED =
  "Owner banned; subscriptions canceled; bots paused.";
export const ADMIN_UNBAN_APPLIED = "Owner unbanned.";
export const ADMIN_OWNER_NOT_FOUND = "Owner not found.";
export const ADMIN_UNAUTHORIZED = "Not authorized.";

// =============================================================================
// Broadcast (admin → all users)
// =============================================================================

export const BROADCAST_PROMPT =
  "📣 Send the message to broadcast. It can be any type — text, photo, video, document — and will be copied to all users exactly as you send it.";
export const BROADCAST_NEED_MESSAGE =
  "Send a message to broadcast, or press Cancel.";
export const BROADCAST_CANCELLED = "Broadcast cancelled.";
export const BROADCAST_NO_AUDIENCE = "No users to broadcast to yet.";

export function broadcastConfirm(count: number): string {
  return `Broadcast this message to ${count} user${count === 1 ? "" : "s"}?`;
}

export const BROADCAST_SENDING = "📤 Broadcasting… this may take a moment.";

export function broadcastDone(args: { sent: number; failed: number }): string {
  const base = `✅ Broadcast sent to ${args.sent} user${args.sent === 1 ? "" : "s"}.`;
  return args.failed > 0
    ? `${base} ${args.failed} could not be reached (blocked or deleted).`
    : base;
}
