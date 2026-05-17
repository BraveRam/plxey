/**
 * Typed event registry for the bot's Inngest app.
 *
 * Mirrors the "Inngest Event Registry" section of SUBSCRIPTION.md. Only
 * event-driven events live here; cron-triggered functions (lapse-sweep,
 * trial-sweep, reminder-scan, usage-reconcile) don't carry payloads.
 *
 * Note: `rag/document.ingest` is owned by apps/rag and is intentionally not
 * redefined here.
 */

export type SubscriptionPaymentEventData = {
  ownerTelegramUserId: string;
  plan: "pro" | "business";
  telegramPaymentChargeId: string;
  starsAmount: number;
  /** Telegram's `subscription_expiration_date`, unix seconds. */
  subscriptionExpirationDate: number;
};

export type SubscriptionStartedEventData = SubscriptionPaymentEventData;
export type SubscriptionRenewedEventData = SubscriptionPaymentEventData;

export type SubscriptionCanceledEventData = {
  ownerTelegramUserId: string;
  telegramPaymentChargeId: string;
};

export type SubscriptionRefundedEventData = {
  ownerTelegramUserId: string;
  telegramPaymentChargeId: string;
};

export type SubscriptionLapsedReason =
  | "trial_expired"
  | "renewal_failed"
  | "refunded"
  | "banned";

export type SubscriptionLapsedEventData = {
  ownerTelegramUserId: string;
  reason: SubscriptionLapsedReason;
};

export type OwnerFirstBotCreatedEventData = {
  ownerTelegramUserId: string;
};

export type OwnerBannedEventData = {
  ownerTelegramUserId: string;
};

export type BotOverQuotaMessageEventData = {
  botId: string;
  customerTelegramUserId: string;
};

export type BotUsageExceededEventData = {
  botId: string;
  ownerTelegramUserId: string;
  messagesThisPeriod: number;
  cap: number;
};

export type NotifyOwnerKind =
  | "trial_started"
  | "trial_ending_7d"
  | "trial_ending_1d"
  | "trial_expired"
  | "subscription_started"
  | "subscription_canceled"
  | "subscription_resumed"
  | "subscription_lapsed"
  | "cancel_3d_before_end"
  | "quota_messages_exceeded"
  | "customer_msg_to_paused_bot"
  | "admin_event_summary";

export type NotifyOwnerEventData = {
  kind: NotifyOwnerKind;
  ownerTelegramUserId: string;
  extras?: Record<string, unknown>;
};

/**
 * Map of event name → payload `data` shape. Inngest v4 client typing pulls
 * event names from this record via `Inngest<{ schemas: ... }>`-style typing.
 * Handlers in this app should `event.data as Events[name]` until a single
 * upstream client typing helper is wired in.
 */
export interface Events {
  "subscription/started": SubscriptionStartedEventData;
  "subscription/renewed": SubscriptionRenewedEventData;
  "subscription/canceled": SubscriptionCanceledEventData;
  "subscription/refunded": SubscriptionRefundedEventData;
  "subscription/lapsed": SubscriptionLapsedEventData;
  "owner/first.bot.created": OwnerFirstBotCreatedEventData;
  "owner/banned": OwnerBannedEventData;
  "bot/over.quota.message": BotOverQuotaMessageEventData;
  "bot/usage.exceeded": BotUsageExceededEventData;
  "notify/owner": NotifyOwnerEventData;
}

export type EventName = keyof Events;
