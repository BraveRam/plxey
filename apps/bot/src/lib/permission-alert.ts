import { redis } from "./redis";

const ALERT_TTL_SECONDS = 30 * 60; // 30 min — matches the in-app expectation.

export function permissionAlertKey(botId: string): string {
  return `alert:perm:${botId}`;
}

/**
 * Try to claim the "permission alert" rate-limit slot for a bot. Returns
 * true if this caller is the first within the TTL window and should send
 * the owner DM. Subsequent callers within the window get false and skip
 * the notification — that's how we throttle the "missing can_reply" alert
 * to once per 30 min per bot, including across process restarts (the
 * in-memory counter we had before reset on restart and re-spammed the
 * owner).
 */
export async function claimPermissionAlertSlot(
  botId: string,
): Promise<boolean> {
  // SET key value NX EX ttl — atomic "set if absent with expiry". Returns
  // "OK" when we won the race, null when the key already existed.
  const result = await redis().set(permissionAlertKey(botId), "1", {
    nx: true,
    ex: ALERT_TTL_SECONDS,
  });
  return result === "OK";
}

/**
 * Clear the alert slot — call when the owner has fixed permissions (we
 * see can_reply granted again) so the next future regression can re-alert
 * immediately instead of waiting out the TTL.
 */
export async function clearPermissionAlertSlot(botId: string): Promise<void> {
  await redis().del(permissionAlertKey(botId));
}
