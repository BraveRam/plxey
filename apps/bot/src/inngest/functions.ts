import type { InngestFunction } from "inngest";

import { cronFunctions } from "./crons";
import { handlerFunctions } from "./handlers";

/**
 * Registry of every Inngest function served by the bot app at /api/inngest.
 * Composed from two sub-directories so the cron sweeps and the
 * event-driven lifecycle handlers can grow independently.
 */
export const functions: InngestFunction.Any[] = [
  ...cronFunctions,
  ...handlerFunctions,
];
