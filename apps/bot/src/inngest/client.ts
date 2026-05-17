import { Inngest } from "inngest";
import type { Events } from "./events";

/**
 * Inngest client for the bot app. Distinct `id` from apps/rag (which uses
 * `tg-rag`) so the two apps register as separate Inngest applications.
 *
 * Inngest v4 dropped the `EventSchemas().fromRecord<T>()` ctor option; static
 * typing on `inngest.send(...)` is now opt-in via per-call typing. We re-export
 * the typed `Events` map from `./events.ts` so handlers and callers can narrow
 * `event.data` to the right shape.
 */
export const inngest = new Inngest({
  id: "tg-business-bot",
});

export type { Events };
