import type { InngestFunction } from "inngest";

/**
 * Registry of every Inngest function served by the bot app at /api/inngest.
 *
 * Intentionally empty at this commit — subsequent phases (cron sweeps,
 * subscription lifecycle handlers, notify/owner DM dispatcher) will append
 * their `inngest.createFunction(...)` results here.
 */
export const functions: InngestFunction.Any[] = [];
