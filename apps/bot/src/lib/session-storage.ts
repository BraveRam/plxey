import type { StorageAdapter } from "grammy";
import type { Redis } from "@upstash/redis";
import { redis as defaultClient } from "./redis";

// Subset of @upstash/redis we use. Keeping it narrow makes the adapter
// trivially testable with a Map-backed fake.
export interface SessionRedisClient {
  get<TData>(key: string): Promise<TData | null>;
  set(key: string, value: unknown): Promise<"OK" | null | unknown>;
  del(key: string): Promise<number | unknown>;
}

export function buildSessionKey(prefix: string, key: string): string {
  return `${prefix}${key}`;
}

/**
 * grammy StorageAdapter backed by Upstash Redis (REST).
 *
 * The `prefix` MUST distinguish independent bots that share this Redis
 * instance — different tenant bots get the same chatId from different
 * customers, so without a per-bot prefix two bots would clobber each
 * other's session for the same chatId. Conventions used in this repo:
 *
 *   tg:session:onboarding:                — the single onboarding bot
 *   tg:session:bot:{tenantBotId}:         — each tenant bot
 *
 * Caveat: every update round-trips through Redis once on read and once on
 * write (the conversations plugin's replay log lives in the session). If
 * Redis is unavailable, updates fail rather than silently fall back to
 * in-memory storage — silent fallback would lose conversation state and
 * cause "Bad replay" errors on the next successful update.
 */
export class UpstashSessionStorage<T> implements StorageAdapter<T> {
  private readonly clientFactory: () => SessionRedisClient;

  constructor(
    private readonly prefix: string,
    clientFactory: () => SessionRedisClient = () => defaultClient() as Redis,
  ) {
    this.clientFactory = clientFactory;
  }

  async read(key: string): Promise<T | undefined> {
    const v = await this.clientFactory().get<T>(
      buildSessionKey(this.prefix, key),
    );
    return v ?? undefined;
  }

  async write(key: string, value: T): Promise<void> {
    await this.clientFactory().set(buildSessionKey(this.prefix, key), value);
  }

  async delete(key: string): Promise<void> {
    await this.clientFactory().del(buildSessionKey(this.prefix, key));
  }
}
