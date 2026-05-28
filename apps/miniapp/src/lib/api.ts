import { getInitData } from "./telegram";
import type {
  PublicBot,
  DocumentItem,
  BillingSummary,
  BotAnalytics,
  BotPermissions,
} from "@/types";

const BASE = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `tma ${getInitData()}`);
  // Don't set Content-Type for FormData — the browser adds the boundary.
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BASE}/api${path}`, { ...init, headers });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body; keep the generic message
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listBots: () => request<PublicBot[]>("/bots"),
  createBot: (token: string) =>
    request<PublicBot>("/bots", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  updateBot: (id: string, patch: Partial<Pick<PublicBot,
    "status" | "systemPrompt" | "welcomeMessage" | "autoReadBusinessMessages"
    | "dailyUserAiReplyLimit" | "dailyCapReachedMessage">>) =>
    request<PublicBot>(`/bots/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteBot: (id: string) =>
    request<{ success: true }>(`/bots/${id}`, { method: "DELETE" }),

  listDocuments: (botId: string) =>
    request<DocumentItem[]>(`/documents?botId=${encodeURIComponent(botId)}`),
  uploadDocument: (botId: string, file: File) => {
    const form = new FormData();
    form.set("botId", botId);
    form.set("file", file);
    return request<{ documentId: string }>("/documents", {
      method: "POST",
      body: form,
    });
  },
  deleteDocument: (id: string) =>
    request<{ success: true }>(`/documents/${id}`, { method: "DELETE" }),
  cancelDocument: (id: string) =>
    request<{ success: true }>(`/documents/${id}/cancel`, { method: "POST" }),

  billing: () => request<BillingSummary>("/owners/billing"),
  analytics: (botId: string) =>
    request<BotAnalytics>(`/bots/${botId}/analytics`),
  permissions: (botId: string) =>
    request<BotPermissions>(`/bots/${botId}/permissions`),
};
