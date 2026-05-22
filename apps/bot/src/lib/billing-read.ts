/**
 * Read-only billing/usage summary for the Mini App
 * (`GET /api/owners/billing`). Mirrors the data the bot's /billing screen
 * shows (`bots/billing.ts`) but returns a flat JSON-friendly DTO instead
 * of composing Telegram message text.
 */

import { eq, desc } from "drizzle-orm";
import { db, owners, subscriptions } from "@tg-business/db";
import { effectivePlan, planLimits, type PlanKey } from "./plans";
import type { SubscriptionStatus } from "./plans";

export interface BillingSummary {
  plan: PlanKey | null;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  subscriptionRenewsAt: string | null;
  usage: {
    bots: number;
    docs: number; // aggregate across all of the owner's bots
    messages: number; // this billing/trial period
  };
  caps: {
    maxBots: number;
    maxDocsPerBot: number;
    maxMessagesPerPeriod: number;
  } | null;
}

const EMPTY: BillingSummary = {
  plan: null,
  status: "lapsed",
  trialEndsAt: null,
  subscriptionRenewsAt: null,
  usage: { bots: 0, docs: 0, messages: 0 },
  caps: null,
};

export async function getBillingSummary(ownerId: string): Promise<BillingSummary> {
  const ownerRow = await db.query.owners.findFirst({
    where: eq(owners.telegramUserId, ownerId),
    columns: {
      currentPlan: true,
      subscriptionStatus: true,
      subscriptionRenewsAt: true,
      trialEndsAt: true,
      botCount: true,
      docCount: true,
      messagesThisPeriod: true,
    },
  });
  if (!ownerRow) return EMPTY;

  const subs = await db.query.subscriptions.findMany({
    where: eq(subscriptions.ownerTelegramUserId, ownerId),
    columns: { plan: true, status: true, currentPeriodEnd: true },
    orderBy: [desc(subscriptions.createdAt)],
  });

  const eff = effectivePlan({
    subscriptionStatus: ownerRow.subscriptionStatus,
    trialEndsAt: ownerRow.trialEndsAt,
    subscriptions: subs,
  });

  return {
    plan: eff.plan,
    status: eff.status,
    trialEndsAt: ownerRow.trialEndsAt?.toISOString() ?? null,
    subscriptionRenewsAt: ownerRow.subscriptionRenewsAt?.toISOString() ?? null,
    usage: {
      bots: ownerRow.botCount,
      docs: ownerRow.docCount,
      messages: ownerRow.messagesThisPeriod,
    },
    caps: eff.plan ? planLimits(eff.plan) : null,
  };
}
