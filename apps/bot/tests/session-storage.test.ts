import { describe, expect, test } from "bun:test";
import {
  buildSessionKey,
  UpstashSessionStorage,
} from "../src/lib/session-storage";

function makeFakeRedis() {
  const store = new Map<string, unknown>();
  return {
    store,
    client: {
      async get<T>(key: string): Promise<T | null> {
        return (store.get(key) as T | undefined) ?? null;
      },
      async set(key: string, value: unknown): Promise<"OK"> {
        store.set(key, value);
        return "OK";
      },
      async del(key: string): Promise<number> {
        const had = store.delete(key);
        return had ? 1 : 0;
      },
    },
  };
}

describe("buildSessionKey", () => {
  test("concatenates prefix and key with no separator", () => {
    expect(buildSessionKey("tg:session:bot:abc:", "12345")).toBe(
      "tg:session:bot:abc:12345",
    );
  });
});

describe("UpstashSessionStorage", () => {
  test("read returns undefined when the key is absent", async () => {
    const fake = makeFakeRedis();
    const storage = new UpstashSessionStorage<{ x: number }>(
      "tg:session:test:",
      () => fake.client,
    );
    expect(await storage.read("missing")).toBeUndefined();
  });

  test("write + read round-trips JSON-serializable values", async () => {
    const fake = makeFakeRedis();
    const storage = new UpstashSessionStorage<{ x: number; y: string }>(
      "tg:session:test:",
      () => fake.client,
    );
    await storage.write("chat-1", { x: 42, y: "hi" });
    expect(await storage.read("chat-1")).toEqual({ x: 42, y: "hi" });
  });

  test("delete removes the value", async () => {
    const fake = makeFakeRedis();
    const storage = new UpstashSessionStorage<number>(
      "tg:session:test:",
      () => fake.client,
    );
    await storage.write("k", 7);
    await storage.delete("k");
    expect(await storage.read("k")).toBeUndefined();
  });

  test("different prefixes isolate writes on the same underlying client", async () => {
    const fake = makeFakeRedis();
    const a = new UpstashSessionStorage<number>(
      "tg:session:a:",
      () => fake.client,
    );
    const b = new UpstashSessionStorage<number>(
      "tg:session:b:",
      () => fake.client,
    );
    await a.write("chat-1", 1);
    await b.write("chat-1", 2);
    expect(await a.read("chat-1")).toBe(1);
    expect(await b.read("chat-1")).toBe(2);
  });

  test("the underlying redis client is keyed exactly by prefix+key (verifies no extra wrapping)", async () => {
    const fake = makeFakeRedis();
    const storage = new UpstashSessionStorage<string>(
      "tg:session:onboarding:",
      () => fake.client,
    );
    await storage.write("999", "ok");
    expect(fake.store.has("tg:session:onboarding:999")).toBe(true);
  });
});
