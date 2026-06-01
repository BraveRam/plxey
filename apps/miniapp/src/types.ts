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
  /** Onboarding bot @username, for the billing deep link. */
  botUsername: string | null;
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

// --- Admin dashboard (mirrors apps/bot/src/lib/admin-metrics.ts) -------------

/** All-time snapshot counters (not bounded by the selected date range). */
export interface AdminKpis {
  totalOwners: number;
  bannedOwners: number;
  activeBots: number;
  totalDocs: number;
  readyDocs: number;
  activePro: number;
  activeBusiness: number;
  mrrStars: number;
  compSubs: number;
}

/** Sums over the selected date window. */
export interface AdminTotals {
  revenueStars: number;
  refundStars: number;
  newOwners: number;
  newSubs: number;
  cancellations: number;
  customerMessages: number;
  aiMessages: number;
  uniqueCustomers: number;
}

/** Zero-filled daily time series over the window. */
export interface AdminSeries {
  revenue: Array<{ date: string; stars: number }>;
  signups: Array<{ date: string; count: number }>;
  newSubs: Array<{ date: string; count: number }>;
  cancellations: Array<{ date: string; count: number }>;
  messages: Array<{ date: string; received: number; answered: number }>;
}

export interface AdminBreakdowns {
  subsByStatus: Record<string, number>;
  subsByPlanActive: Record<string, number>;
  botsByStatus: Record<string, number>;
  docsByStatus: Record<string, number>;
}

export interface AdminMetrics {
  range: { from: string; to: string };
  kpis: AdminKpis;
  totals: AdminTotals;
  series: AdminSeries;
  breakdowns: AdminBreakdowns;
}

export interface AdminOwnerRow {
  telegramUserId: string;
  username: string | null;
  firstName: string | null;
  currentPlan: string | null;
  subscriptionStatus: string;
  botCount: number;
  docCount: number;
  messagesThisPeriod: number;
  lifetimeStarsSpent: number;
  isBanned: boolean;
  firstSeenAt: string;
}

export interface AdminOwnersPage {
  rows: AdminOwnerRow[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  total: number;
}

export interface AdminOwnerDetail extends AdminOwnerRow {
  subscriptions: Array<{
    plan: string;
    status: string;
    isComplimentary: boolean;
    starsPerPeriod: number;
    currentPeriodEnd: string;
    canceledAt: string | null;
  }>;
  bots: Array<{
    botUsername: string | null;
    status: string;
    overQuotaAt: string | null;
  }>;
}
