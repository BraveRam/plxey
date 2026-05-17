/**
 * Weekly cron: recompute `owners.bot_count` and `owners.doc_count` from
 * the base tables.
 *
 * From SUBSCRIPTION.md "Plan-Cap Enforcement → Bot count and doc count
 * denormalization":
 *   Counters are atomically bumped on every create/delete. This job is
 *   drift insurance against counter bugs (failed transactions, race
 *   conditions, manual DB ops, etc).
 *
 * Single UPDATE with correlated subqueries — avoids per-owner iteration.
 * Runs Sunday 4am UTC, off-hours globally for the lowest contention.
 *
 *   bot_count = count of tenant_bots rows where the bot's tenant belongs to
 *               this owner (tenants.telegram_owner_id = owners.telegram_user_id).
 *   doc_count = same shape, for documents.
 *
 * Note: doc_count is intentionally a per-owner rollup (sum across all the
 * owner's bots), not a per-bot count. Per-bot doc cap enforcement lives in
 * `checkQuota` and uses a fresh `COUNT(*)` query rather than a denormalized
 * column.
 */

import { sql } from "drizzle-orm";
import { db } from "@tg-business/db";
import { logger } from "../../lib/logger";
import { inngest } from "../client";

export const usageReconcile = inngest.createFunction(
  {
    id: "cron-usage-reconcile",
    concurrency: { limit: 1 },
    triggers: [{ cron: "0 4 * * 0" }],
  },
  async ({ step }) => {
    const result = await step.run("recompute-counters", async () => {
      // Single UPDATE with correlated subqueries. Postgres evaluates the
      // subqueries per row of owners; the indexed FK lookups on tenants /
      // tenant_bots / documents keep it fast.
      const res = await db.execute(sql`
        update owners o
        set
          bot_count = coalesce((
            select count(*)::int
            from tenant_bots tb
            join tenants t on t.id = tb.tenant_id
            where t.telegram_owner_id = o.telegram_user_id
          ), 0),
          doc_count = coalesce((
            select count(*)::int
            from documents d
            join tenants t on t.id = d.tenant_id
            where t.telegram_owner_id = o.telegram_user_id
          ), 0),
          updated_at = now()
        where
          o.bot_count <> coalesce((
            select count(*)::int
            from tenant_bots tb
            join tenants t on t.id = tb.tenant_id
            where t.telegram_owner_id = o.telegram_user_id
          ), 0)
          or o.doc_count <> coalesce((
            select count(*)::int
            from documents d
            join tenants t on t.id = d.tenant_id
            where t.telegram_owner_id = o.telegram_user_id
          ), 0)
      `);

      // The Neon HTTP driver surfaces a rowCount on the result. We treat
      // missing as 0 so the function still returns a structured summary.
      const rowCount =
        typeof (res as { rowCount?: number }).rowCount === "number"
          ? (res as { rowCount: number }).rowCount
          : 0;
      return { reconciled: rowCount };
    });

    if (result.reconciled > 0) {
      logger.info(
        { reconciled: result.reconciled },
        "usage-reconcile: drift corrected",
      );
    }

    return result;
  },
);
