import { PostHog } from "posthog-node";
import type { User } from "grammy/types";
import { logger } from "./logger";

/**
 * PostHog product-analytics wrapper.
 *
 * Two person types (prefixed distinct_ids so the same Telegram user can be
 * both an owner of one bot and a customer of another):
 *
 *   - "owner:<telegram_user_id>"    — paying SaaS customers
 *   - "customer:<telegram_user_id>" — end users chatting with tenant bots
 *
 * Every event includes `groups: { bot: <botId> }` when bot context exists,
 * so PostHog dashboards roll up by tenant bot.
 *
 * When `POSTHOG_PROJECT_TOKEN` is unset, every public function is a no-op
 * (dev environments stay silent). When set, network calls are buffered by
 * posthog-node's internal batcher and we never block the caller.
 */

const DEFAULT_HOST = "https://us.i.posthog.com";

let cached: PostHog | null = null;
let warnedDisabled = false;
const identifiedPersons = new Set<string>();
const identifiedGroups = new Set<string>();

function client(): PostHog | null {
  if (cached) return cached;
  const token = process.env.POSTHOG_PROJECT_TOKEN;
  if (!token) {
    if (!warnedDisabled) {
      warnedDisabled = true;
      logger.info("PostHog disabled — POSTHOG_PROJECT_TOKEN not set");
    }
    return null;
  }
  const host = process.env.POSTHOG_HOST?.trim() || DEFAULT_HOST;
  cached = new PostHog(token, {
    host,
    // posthog-node defaults: flushAt=20, flushInterval=10s. We keep the
    // defaults — webhook bursts are small, and a 10s buffer survives
    // process restarts via the shutdown flush below.
  });
  logger.info({ host }, "PostHog enabled");
  return cached;
}

export function ownerDistinctId(telegramUserId: string | number): string {
  return `owner:${telegramUserId}`;
}

export function customerDistinctId(telegramUserId: string | number): string {
  return `customer:${telegramUserId}`;
}

function safeName(s: string | undefined | null): string | undefined {
  if (!s) return undefined;
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Fire-and-forget event capture. Callers don't await — posthog-node
 * batches internally. `groups` is optional; pass `{ bot: botId }` for
 * any per-bot event.
 */
export function track(
  distinctId: string,
  event: string,
  properties: Record<string, unknown> = {},
  groups: Record<string, string> = {},
): void {
  const ph = client();
  if (!ph) return;
  try {
    ph.capture({
      distinctId,
      event,
      properties,
      ...(Object.keys(groups).length > 0 ? { groups } : {}),
    });
  } catch (err) {
    logger.warn({ err, event }, "posthog capture failed");
  }
}

/**
 * Identify an owner with their Telegram profile fields. Dedups per
 * process — second call for the same user is a no-op so we don't
 * thrash posthog-node's identify queue.
 */
export function identifyOwner(from: User): void {
  const ph = client();
  if (!ph) return;
  const distinctId = ownerDistinctId(from.id);
  if (identifiedPersons.has(distinctId)) return;
  identifiedPersons.add(distinctId);
  try {
    ph.identify({
      distinctId,
      properties: {
        firstName: safeName(from.first_name),
        lastName: safeName(from.last_name),
        username: safeName(from.username),
        languageCode: safeName(from.language_code),
        isPremium: from.is_premium ?? false,
      },
    });
  } catch (err) {
    logger.warn({ err, telegramUserId: from.id }, "posthog identifyOwner failed");
  }
}

/**
 * Identify a customer. Pins the customer to the `bot` group from the
 * first event onward so dashboards roll up cleanly. Dedups per process.
 */
export function identifyCustomer(
  from: User,
  botId: string,
): void {
  const ph = client();
  if (!ph) return;
  const distinctId = customerDistinctId(from.id);
  if (identifiedPersons.has(distinctId)) return;
  identifiedPersons.add(distinctId);
  try {
    ph.identify({
      distinctId,
      properties: {
        firstName: safeName(from.first_name),
        lastName: safeName(from.last_name),
        username: safeName(from.username),
        languageCode: safeName(from.language_code),
      },
    });
    track(distinctId, "customer.identified", {}, { bot: botId });
  } catch (err) {
    logger.warn(
      { err, telegramUserId: from.id, botId },
      "posthog identifyCustomer failed",
    );
  }
}

/**
 * Register a `bot` group with descriptive properties. Called once at
 * bot load. Subsequent calls for the same botId are no-ops.
 */
export function identifyBotGroup(
  botId: string,
  properties: {
    botUsername: string | null;
    ownerTelegramUserId: string;
    tenantId: string;
  },
): void {
  const ph = client();
  if (!ph) return;
  if (identifiedGroups.has(botId)) return;
  identifiedGroups.add(botId);
  try {
    ph.groupIdentify({
      groupType: "bot",
      groupKey: botId,
      properties: {
        botUsername: properties.botUsername,
        ownerTelegramUserId: properties.ownerTelegramUserId,
        tenantId: properties.tenantId,
      },
    });
  } catch (err) {
    logger.warn({ err, botId }, "posthog identifyBotGroup failed");
  }
}

/**
 * Flush pending events. Called from the shutdown handler so a Ctrl-C
 * or rolling deploy doesn't drop the in-flight batch. Bounded by a
 * timeout so a hung PostHog doesn't block restart.
 */
export async function flush(timeoutMs = 2000): Promise<void> {
  const ph = cached;
  if (!ph) return;
  try {
    await Promise.race([
      ph.shutdown(),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch (err) {
    logger.warn({ err }, "posthog flush failed");
  }
}

/** Reset internal dedup state. Test-only. */
export function _resetForTests(): void {
  cached = null;
  warnedDisabled = false;
  identifiedPersons.clear();
  identifiedGroups.clear();
}
