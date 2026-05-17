/**
 * Cron-triggered Inngest functions for the bot app.
 *
 * Exported as a single `cronFunctions` array so the bot entry point can mount
 * them alongside the event-driven handlers via `serve({ functions: [...] })`.
 *
 * Schedules (chosen to avoid overlap; see individual files for rationale):
 *   - cron-lapse-sweep:     hourly,         minute 0
 *   - cron-trial-sweep:     hourly,         minute 5
 *   - cron-reminder-scan:   daily,          10:00 UTC
 *   - cron-usage-reconcile: weekly Sunday,  04:00 UTC
 */

import type { InngestFunction } from "inngest";
import { lapseSweep } from "./lapse-sweep";
import { trialSweep } from "./trial-sweep";
import { reminderScan } from "./reminder-scan";
import { usageReconcile } from "./usage-reconcile";

export const cronFunctions: InngestFunction.Any[] = [
  lapseSweep,
  trialSweep,
  reminderScan,
  usageReconcile,
];
