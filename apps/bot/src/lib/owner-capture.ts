import type { Context, MiddlewareFn } from "grammy";
import { upsertOwnerProfile } from "./owners";
import { logger } from "./logger";
import { identifyOwner } from "./analytics";

/**
 * Opportunistic owner-profile upsert middleware. Runs upsertOwnerProfile
 * on every update with a `from` user. Fail-open: errors are caught and
 * logged, never propagated.
 *
 * Use on the onboarding bot (every owner update) and on tenant bots
 * filtered to non-business-chat updates (the owner-side surface).
 *
 * The owner-side filter is the caller's responsibility — apply this
 * middleware AFTER bot.filter(!isBusinessChatUpdate) on tenant bots.
 *
 * We use `void` + `.catch` instead of `await` so the upsert happens in
 * the background. Per-request latency stays unchanged. The price: if
 * upsertOwnerProfile is slow, the request returns first and the upsert
 * finishes after. Acceptable.
 *
 * We skip bots (`is_bot=true`) — they never become subscription owners.
 */
export function ownerCaptureMiddleware(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    if (ctx.from && !ctx.from.is_bot) {
      // Don't block on failure — let the request continue.
      void upsertOwnerProfile(ctx.from).catch((err: unknown) => {
        logger.warn(
          { err, userId: ctx.from?.id },
          "owner profile upsert failed",
        );
      });
      // Identify in PostHog. Dedups per process inside `identifyOwner`,
      // so this is effectively once-per-owner per process even though we
      // call it on every update.
      identifyOwner(ctx.from);
    }
    await next();
  };
}
