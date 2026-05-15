import { Hono } from "hono";
import { api } from "./routes";
import { logger } from "./lib/logger";

const app = new Hono();

app.route("/api", api);

app.get("/health", (c) => c.text("OK"));

const port = Number(process.env.API_PORT || 3001);
Bun.serve({ fetch: app.fetch, port });

logger.info({ port }, "API server started");
