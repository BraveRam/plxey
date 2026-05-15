import { Hono } from "hono";
import { createOnboardingBot } from "./bots/onboarding";
import { registry } from "./bots/registry";
import { logger, pinoLogger } from "./lib/logger";

const app = new Hono();

app.use(pinoLogger());

const onboardingBot = await createOnboardingBot();

app.post("/webhook/onboarding", async (c) => {
  try {
    const update = await c.req.json();
    await onboardingBot.handleUpdate(update);
    return c.text("OK");
  } catch (err) {
    logger.error({ err }, "onboarding webhook error");
    return c.text("Error", 500);
  }
});

app.post("/webhook/tenant/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const bot = await registry.get(id);
    if (!bot) return c.text("Bot not found", 404);
    const update = await c.req.json();
    await bot.handleUpdate(update);
    return c.text("OK");
  } catch (err) {
    logger.error({ err, botId: c.req.param("id") }, "tenant webhook error");
    return c.text("Error", 500);
  }
});

app.get("/health", (c) => c.text("OK"));

async function start() {
  const server = Bun.serve({
    fetch: app.fetch,
    port: Number(process.env.BOT_PORT || 3000),
  });

  logger.info({ port: server.port }, "bot server started");

  const webhookBase = process.env.PUBLIC_URL;
  if (webhookBase) {
    try {
      const onboardingUrl = `${webhookBase}/webhook/onboarding`;
      await onboardingBot.api.setWebhook(onboardingUrl, { drop_pending_updates: true });
      logger.info({ url: onboardingUrl }, "onboarding bot webhook set");
    } catch (err) {
      logger.error({ err }, "failed to set onboarding webhook");
    }
  } else {
    logger.warn("PUBLIC_URL not set — webhooks not registered");
  }
}

start().catch((err) => { logger.fatal({ err }, "bot failed to start"); process.exit(1); });
