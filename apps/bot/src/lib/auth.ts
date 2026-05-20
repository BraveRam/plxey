import { createHmac } from "crypto";
import type { Context, Next } from "hono";

/**
 * Verifies Telegram Mini App initData against the bot token.
 * See https://core.telegram.org/bots/webapps#validating-data-received-from-the-mini-app
 */
export async function verifyInitData(initData: string, botToken: string): Promise<{ id: number; [key: string]: unknown } | null> {
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get("hash");
    if (!hash) return null;

    urlParams.delete("hash");

    const params = Array.from(urlParams.entries());
    params.sort(([a], [b]) => a.localeCompare(b));

    const dataCheckString = params.map(([key, value]) => `${key}=${value}`).join("\n");

    const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
    const calculatedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    if (calculatedHash !== hash) return null;

    const userJson = urlParams.get("user");
    if (!userJson) return null;

    const user = JSON.parse(userJson);
    if (typeof user.id !== "number") return null;

    return user;
  } catch (err) {
    return null;
  }
}

/**
 * Middleware that requires a valid X-Telegram-Init-Data header.
 * Sets the verified user in c.get("user").
 */
export const authMiddleware = async (c: Context, next: Next) => {
  const initData = c.req.header("X-Telegram-Init-Data");
  if (!initData) {
    return c.json({ error: "Unauthorized: Missing X-Telegram-Init-Data header" }, 401);
  }

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    console.error("BOT_TOKEN environment variable not set");
    return c.json({ error: "Internal Server Error" }, 500);
  }

  const user = await verifyInitData(initData, botToken);
  if (!user) {
    return c.json({ error: "Unauthorized: Invalid Telegram initData" }, 401);
  }

  c.set("user", user);
  await next();
};
