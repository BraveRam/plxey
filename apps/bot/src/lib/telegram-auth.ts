/**
 * Telegram Mini App `initData` verification.
 *
 * The Mini App ships `Telegram.WebApp.initData` (a URL-encoded query
 * string) on every API request. It is signed by Telegram with the bot
 * token of the bot that launched the WebApp — here, the onboarding bot
 * (`BOT_TOKEN`). Verifying the HMAC proves the caller is a real Telegram
 * user and gives us their user id, which we use to scope all data access.
 *
 * Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

import { createHmac, timingSafeEqual } from "crypto";

export interface InitDataUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export type VerifyInitDataResult =
  | { ok: true; user: InitDataUser; authDate: number }
  | { ok: false; reason: string };

// Default freshness window. initData older than this is rejected to limit
// replay of a leaked string.
const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Verify a Telegram Mini App initData string against a bot token.
 *
 * @param initData  Raw `Telegram.WebApp.initData` (URL-encoded query string).
 * @param botToken  The launching bot's token (BOT_TOKEN).
 * @param maxAgeSeconds  Reject if `auth_date` is older than this.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number = DEFAULT_MAX_AGE_SECONDS,
): VerifyInitDataResult {
  if (!initData) return { ok: false, reason: "missing initData" };
  if (!botToken) return { ok: false, reason: "missing bot token" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing hash" };

  // Build the data-check-string: every field except `hash` (and the
  // newer Ed25519 `signature` field, which is not part of the HMAC
  // check), sorted alphabetically, joined as `key=value` by `\n`.
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash" || key === "signature") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  // Constant-time compare. Lengths must match for timingSafeEqual.
  const a = Buffer.from(computedHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad hash" };
  }

  const authDateRaw = params.get("auth_date");
  const authDate = authDateRaw ? Number(authDateRaw) : NaN;
  if (!Number.isFinite(authDate)) {
    return { ok: false, reason: "missing auth_date" };
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > maxAgeSeconds) {
    return { ok: false, reason: "stale auth_date" };
  }

  const userRaw = params.get("user");
  if (!userRaw) return { ok: false, reason: "missing user" };
  let user: InitDataUser;
  try {
    user = JSON.parse(userRaw) as InitDataUser;
  } catch {
    return { ok: false, reason: "bad user json" };
  }
  if (typeof user.id !== "number") {
    return { ok: false, reason: "missing user id" };
  }

  return { ok: true, user, authDate };
}
