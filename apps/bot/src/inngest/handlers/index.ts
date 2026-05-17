/**
 * Aggregate exporter for every event-driven Inngest handler in the bot app.
 *
 * Mount path: `apps/bot/src/inngest/functions.ts` spreads this array into
 * the top-level `functions` registry served at `/api/inngest`. Cron handlers
 * live in `../crons/` and are mounted separately (Phase 3a).
 *
 * See SUBSCRIPTION.md "Inngest Event Registry".
 */

import { subscriptionStarted } from "./subscription-started";
import { subscriptionRenewed } from "./subscription-renewed";
import { subscriptionCanceled } from "./subscription-canceled";
import { subscriptionRefunded } from "./subscription-refunded";
import { subscriptionLapsed } from "./subscription-lapsed";
import { ownerFirstBotCreated } from "./owner-first-bot-created";
import { ownerBanned } from "./owner-banned";
import { botOverQuotaMessage } from "./bot-over-quota-message";
import { botUsageExceeded } from "./bot-usage-exceeded";
import { notifyOwner } from "./notify-owner";

export const handlerFunctions = [
  subscriptionStarted,
  subscriptionRenewed,
  subscriptionCanceled,
  subscriptionRefunded,
  subscriptionLapsed,
  ownerFirstBotCreated,
  ownerBanned,
  botOverQuotaMessage,
  botUsageExceeded,
  notifyOwner,
];
