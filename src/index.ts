import { Hono } from "hono";
import { createOnboardingBot } from "./bots/onboarding";
import { registry } from "./bots/registry";
import { api } from "./api/routes";

const app = new Hono();

app.route("/api", api);

const onboardingBot = await createOnboardingBot();

app.post("/webhook/onboarding", async (c) => {
  try {
    const update = await c.req.json();
    await onboardingBot.handleUpdate(update);
    return c.text("OK");
  } catch (err) {
    console.error("onboarding webhook error", err);
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
    console.error("tenant webhook error", err);
    return c.text("Error", 500);
  }
});

app.get("/health", (c) => c.text("OK"));

async function start() {
  const server = Bun.serve({
    fetch: app.fetch,
    port: 3000,
  });

  console.log(`Server running on http://localhost:${server.port}`);

  const webhookBase = process.env.PUBLIC_URL;
  if (webhookBase) {
    try {
      const onboardingUrl = `${webhookBase}/webhook/onboarding`;
      await onboardingBot.api.setWebhook(onboardingUrl, { drop_pending_updates: true });
      console.log(`Onboarding bot webhook set → ${onboardingUrl}`);
    } catch (err) {
      console.error("Failed to set onboarding webhook:", err);
    }
  } else {
    console.log("PUBLIC_URL not set. Set it to your ngrok URL and restart to register webhooks.");
  }
}

start().catch(console.error);
