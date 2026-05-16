import type { Context, MiddlewareFn } from "grammy";

/**
 * Per-chat update serialization middleware.
 *
 * Ensures that two updates from the same chat are never processed
 * concurrently — the second one waits for the first to finish before
 * running.
 *
 * Why this matters: @grammyjs/conversations maintains a per-chat "log" of
 * `ctx.api.*` calls in session storage. If two updates from the same chat
 * are handled concurrently, both threads read + write the log
 * simultaneously and corrupt each other's state. The symptom is a
 * `Bad replay, expected op X` error the next time a conversation tries
 * to resume.
 *
 * Install this BEFORE `bot.use(conversations())` so the queue serializes
 * around the session load/save that the conversations plugin performs.
 */
export function sequentializeByChat<C extends Context>(): MiddlewareFn<C> {
  const queues = new Map<string, Promise<unknown>>();
  return async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) {
      await next();
      return;
    }
    const key = String(chatId);
    const prev = queues.get(key) ?? Promise.resolve();
    // Chain regardless of whether `prev` resolved or rejected — a failing
    // earlier handler must not block the next update from running.
    const current = prev.then(() => next(), () => next()).catch(() => {});
    queues.set(key, current);
    try {
      await current;
    } finally {
      // If no newer update queued itself behind us, drop the slot so the
      // map doesn't grow without bound.
      if (queues.get(key) === current) {
        queues.delete(key);
      }
    }
  };
}
