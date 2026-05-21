import { createHmac } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
}

export interface WebAppInitData {
  query_id?: string;
  user?: TelegramUser;
  receiver?: TelegramUser;
  chat?: {
    id: number;
    type: "group" | "supergroup" | "channel";
    title: string;
    username?: string;
    photo_url?: string;
  };
  chat_type?: "sender" | "private" | "group" | "supergroup" | "channel";
  chat_instance?: string;
  start_param?: string;
  can_send_after?: number;
  auth_date: number;
  hash: string;
}

export function verifyInitData(initData: string, token: string): WebAppInitData | null {
  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get("hash");
  if (!hash) return null;

  const data: string[] = [];
  urlParams.sort();
  for (const [key, value] of urlParams.entries()) {
    if (key !== "hash") {
      data.push(`${key}=${value}`);
    }
  }

  const dataCheckString = data.join("\n");

  const secretKey = createHmac("sha256", "WebAppData")
    .update(token)
    .digest();

  const calculatedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (calculatedHash !== hash) return null;

  const userStr = urlParams.get("user");
  const user = userStr ? (JSON.parse(userStr) as TelegramUser) : undefined;

  return {
    query_id: urlParams.get("query_id") ?? undefined,
    user,
    auth_date: parseInt(urlParams.get("auth_date") ?? "0", 10),
    hash,
  };
}

export const authMiddleware: MiddlewareHandler<{
  Variables: {
    user: TelegramUser;
  };
}> = async (c, next) => {
  const initData = c.req.header("Authorization");
  if (!initData) {
    return c.json({ error: "Missing Authorization header" }, 401);
  }

  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error("BOT_TOKEN not set");
    return c.json({ error: "Internal server error" }, 500);
  }

  const validated = verifyInitData(initData, token);
  if (!validated || !validated.user) {
    return c.json({ error: "Invalid authorization" }, 401);
  }

  // Reject data older than 24 hours to prevent replay attacks
  const TWENTY_FOUR_HOURS_SEC = 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1000);
  if (now - validated.auth_date > TWENTY_FOUR_HOURS_SEC) {
    return c.json({ error: "Authorization expired" }, 401);
  }

  c.set("user", validated.user);
  await next();
};
