// Client-side mirror of the bot API DTOs (apps/bot/src/lib/*). Kept local
// to avoid coupling the browser bundle to server packages.

export interface PublicBot {
  id: string;
  tenantId: string;
  botUsername: string | null;
  status: string; // "active" | "paused" | "revoked"
  systemPrompt: string;
  welcomeMessage: string | null;
  autoReadBusinessMessages: boolean;
  dailyUserAiReplyLimit: number | null;
  dailyCapReachedMessage: string | null;
  createdAt: string;
}

export interface DocumentItem {
  id: string;
  tenantId: string;
  fileName: string;
  mimeType: string;
  status: string; // "processing" | "ready" | "failed"
  source: string;
  createdAt: string;
}

export type PlanKey = "trial" | "pro" | "business";
export type SubscriptionStatus = "trialing" | "active" | "canceled" | "lapsed";

export interface BillingSummary {
  plan: PlanKey | null;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  subscriptionRenewsAt: string | null;
  usage: { bots: number; docs: number; messages: number };
  caps: {
    maxBots: number;
    maxDocsPerBot: number;
    maxMessagesPerPeriod: number;
  } | null;
}

export interface StatsBucket {
  received: number;
  answered: number;
  customers: number;
}

export interface BotAnalytics {
  today: StatsBucket;
  last7d: StatsBucket;
  last30d: StatsBucket;
  lastMessageAt: string | null;
}

export interface BotPermissions {
  connected: boolean;
  isEnabled: boolean;
  rights: Record<string, boolean | undefined> | null;
  lastSyncedAt: string | null;
}
