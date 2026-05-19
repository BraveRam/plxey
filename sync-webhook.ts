// One-shot: sync the onboarding bot's webhook + secret with Telegram.
// Run with `bun sync-webhook.ts`. Reads .env automatically.

import { Bot } from "grammy";

const token = process.env.BOT_TOKEN;
const publicUrl = process.env.PUBLIC_URL;
const secret = process.env.ONBOARDING_WEBHOOK_SECRET;

if (!token) throw new Error("BOT_TOKEN missing");
if (!publicUrl) throw new Error("PUBLIC_URL missing");
if (!secret) throw new Error("ONBOARDING_WEBHOOK_SECRET missing");

const url = `${publicUrl}/webhook/onboarding`;
const bot = new Bot(token);
await bot.api.setWebhook(url, {
  drop_pending_updates: true,
  secret_token: secret,
});

console.log(`✅ webhook synced: ${url}`);
console.log(`   secret length: ${secret.length}`);
