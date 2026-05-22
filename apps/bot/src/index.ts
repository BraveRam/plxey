import { Hono } from "hono";
import { serve as serveInngest } from "inngest/hono";
import { randomBytes } from "crypto";
import { createOnboardingBot } from "./bots/onboarding";
import { registry } from "./bots/registry";
import {
  isOwnerBannedCached,
  loadBannedOwnersCache,
} from "./lib/banned";
import {
  flush as flushAnalytics,
  ownerDistinctId,
  track,
} from "./lib/analytics";
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

    // Resolve the bot from the in-memory registry. Cache hit: zero DB
    // round-trips (registry.get only goes to DB on miss). The banned
    // check below uses the cached BotEntry.ownerTelegramId + the
    // in-memory banned-owners Set, also zero DB hits. Net: a typical
    // /start hits Telegram once and does no DB I/O before handleUpdate.
    const bot = await registry.get(id);
    if (!bot) {
      // Webhook fired for a bot the registry no longer serves —
      // paused/deleted/over-quota. Telegram's 200 stops retries; we
      // still want PostHog to surface the volume so an unexpected
      // spike is visible.
      track("system", "error.webhook.bot_not_active", { botId: id });
      return c.text("Bot not active", 200);
    }

    // Banned-owner ingress drop. Return 200 to Telegram (so it stops
    // retrying) but skip handler entirely — no AI calls, no costs
    // incurred on banned owners' traffic. See SUBSCRIPTION.md "Bans".
    const entry = registry.getEntry(id);
    if (entry && isOwnerBannedCached(entry.ownerTelegramId)) {
      track(
        ownerDistinctId(entry.ownerTelegramId),
        "error.banned_ingress_drop",
        {},
        { bot: id },
      );
      return c.text("OK", 200);
    }

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

  // Hydrate the in-memory banned-owners cache before accepting webhooks
  // so the first request after a restart isn't a DB round-trip. Fail-
  // open: log and continue with an empty set if Neon is unreachable.
  try {
    await loadBannedOwnersCache();
    logger.info("banned-owners cache loaded");
  } catch (err) {
    logger.warn({ err }, "banned-owners cache load failed — starting empty");
  }

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

  // Point the onboarding bot's chat menu button at the Mini App so every
  // owner gets a one-tap "Manage" launcher. Idempotent; skipped when the
  // Mini App origin isn't configured.
  const miniappOrigin = process.env.MINIAPP_ORIGIN;
  if (miniappOrigin) {
    try {
      await onboardingBot.api.setChatMenuButton({
        menu_button: {
          type: "web_app",
          text: "Open",
          web_app: { url: miniappOrigin },
        },
      });
      logger.info({ url: miniappOrigin }, "onboarding menu button set to Mini App");
    } catch (err) {
      logger.error({ err }, "failed to set onboarding menu button");
    }
  } else {
    logger.warn("MINIAPP_ORIGIN not set — Mini App menu button not registered");
  }

  // Drain the PostHog event buffer on SIGINT/SIGTERM so a rolling
  // deploy or Ctrl-C doesn't drop in-flight events. Bounded to 2s
  // inside `flush` so a hung PostHog client can't block shutdown.
  const drainAndExit = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    await flushAnalytics();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void drainAndExit("SIGINT");
  });
  process.on("SIGTERM", () => {
    void drainAndExit("SIGTERM");
  });
}

start().catch((err) => { logger.fatal({ err }, "bot failed to start"); process.exit(1); });
