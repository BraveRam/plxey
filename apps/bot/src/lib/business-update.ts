import type { Update } from "grammy/types";

/**
 * True if the update is from the customer-facing Business Connection
 * channel — i.e., a customer chatting with the tenant owner, routed
 * through our bot.
 *
 * We use this to *exclude* such updates from the owner-side rate limit
 * on tenant bots. Customer messages already pass through
 * `customerMessageLimiter` (10/60s per customer) before hitting the AI,
 * so layering a generic per-user limit on top would either be redundant
 * (counts the same hits twice) or cap the AI handler differently from
 * its existing dedicated limit. The owner-side limit is meant for
 * everything else: callback queries on admin notifications, the Reply
 * flow, owner DMs to the bot.
 */
export function isBusinessChatUpdate(update: Update): boolean {
  return Boolean(
    update.business_message ||
      update.edited_business_message ||
      update.business_connection ||
      update.deleted_business_messages,
  );
}
