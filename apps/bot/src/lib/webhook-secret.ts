import { timingSafeEqual } from "crypto";

export const WEBHOOK_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

export function verifyWebhookSecret(
  expected: string,
  actual: string | null | undefined,
): boolean {
  if (!expected) return false;
  if (typeof actual !== "string" || actual.length === 0) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
