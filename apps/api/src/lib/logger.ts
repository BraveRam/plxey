import pino from "pino";

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug");

const logger = pino({
  level,
  ...(process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});

export { logger };
