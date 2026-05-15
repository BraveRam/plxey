import pino from "pino";
import type { MiddlewareHandler } from "hono";

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug");

const logger = pino({
  level,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "body.token",
      "body.botTokenEncrypted",
      "token",
      "botTokenEncrypted",
    ],
    censor: "[REDACTED]",
  },
  ...(process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});

function pinoLogger(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    logger.info(
      {
        req: { method: c.req.method, path: c.req.path },
        res: { status: c.res.status, duration },
      },
      "request completed",
    );
  };
}

export { logger, pinoLogger };
