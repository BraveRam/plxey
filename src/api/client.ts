import { logger } from "../lib/logger";

const BASE = `http://127.0.0.1:${process.env.PORT || 3000}`;

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    logger.warn({ path, method: options?.method ?? "GET", status: res.status }, "API client error");
    throw new Error(body.error || `API error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  telegramOwnerId: string;
  createdAt: string;
}

interface Bot {
  id: string;
  tenantId: string;
  botTokenEncrypted: string;
  botUsername: string | null;
  status: string;
  webhookSecret: string;
  systemPrompt: string;
  createdAt: string;
}

export const api = {
  getOrCreateTenant(telegramOwnerId: string): Promise<Tenant> {
    return apiFetch("/api/tenants", {
      method: "POST",
      body: JSON.stringify({ telegramOwnerId }),
    });
  },

  listBots(userId: string): Promise<Bot[]> {
    return apiFetch(`/api/bots?userId=${encodeURIComponent(userId)}`);
  },

  createBot(token: string, telegramOwnerId: string): Promise<Bot> {
    return apiFetch("/api/bots", {
      method: "POST",
      body: JSON.stringify({ token, telegramOwnerId }),
    });
  },

  updateBot(botId: string, data: { status?: string; systemPrompt?: string }): Promise<Bot> {
    return apiFetch(`/api/bots/${botId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  deleteBot(botId: string): Promise<{ success: boolean }> {
    return apiFetch(`/api/bots/${botId}`, { method: "DELETE" });
  },
};
