import { Hono } from "hono";
import { serve as serveInngest } from "inngest/hono";
import { randomBytes } from "crypto";
import { createOnboardingBot } from "./bots/onboarding";
import { registry } from "./bots/registry";
import { logger, pinoLogger } from "./lib/logger";
import { api } from "./api/routes";
import { verifyWebhookSecret, WEBHOOK_SECRET_HEADER } from "./lib/webhook-secret";
import { inngest } from "./inngest/client";
import { functions as inngestFunctions } from "./inngest/functions";

const app = new Hono();

app.use(pinoLogger());

// Inngest mounts before the /api router so its Sync/PUT/POST traffic
// bypasses the per-IP /api rate limiter and isn't shadowed by api routes.
const inngestHandler = serveInngest({
  client: inngest,
  functions: inngestFunctions,
});
app.all("/api/inngest", async (c) => inngestHandler(c));

app.route("/api", api);

const onboardingBot = await createOnboardingBot();

const onboardingWebhookSecret =
  process.env.ONBOARDING_WEBHOOK_SECRET ?? randomBytes(16).toString("hex");

app.post("/webhook/onboarding", async (c) => {
  if (
    !verifyWebhookSecret(
      onboardingWebhookSecret,
      c.req.header(WEBHOOK_SECRET_HEADER),
    )
  ) {
    logger.warn("onboarding webhook secret mismatch");
    return c.text("Unauthorized", 401);
  }
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
    if (!bot) return c.text("Bot not active", 200);

    const secret = registry.getWebhookSecret(id);
    if (
      !secret ||
      !verifyWebhookSecret(secret, c.req.header(WEBHOOK_SECRET_HEADER))
    ) {
      logger.warn({ botId: id }, "tenant webhook secret mismatch");
      return c.text("Unauthorized", 401);
    }

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
      await onboardingBot.api.setWebhook(onboardingUrl, {
        drop_pending_updates: true,
        secret_token: onboardingWebhookSecret,
      });
      logger.info({ url: onboardingUrl }, "onboarding bot webhook set");
    } catch (err) {
      logger.error({ err }, "failed to set onboarding webhook");
    }
  } else {
    logger.warn("PUBLIC_URL not set — webhooks not registered");
  }
}

start().catch((err) => { logger.fatal({ err }, "bot failed to start"); process.exit(1); });
