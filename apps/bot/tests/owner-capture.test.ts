import { describe, expect, test, mock } from "bun:test";
import type { Context } from "grammy";

// Stub the owners module before importing the middleware so we don't
// touch the real upsertOwnerProfile (which talks to the DB). The
// parallel Phase 2a agent owns `lib/owners.ts`; we test the middleware
// in isolation against the contract.
const upsertCalls: Array<{ id: number; is_bot?: boolean }> = [];
let nextUpsertResult: Promise<void> = Promise.resolve();

// `mock.module` in Bun is process-wide and persists across test files.
// We stub `upsertOwnerProfile` / `touchOwner` to test the middleware in
// isolation, but other test files (billing.test.ts, owners.test.ts,
// registry.test.ts) import additional symbols from this module
// transitively (`recomputeEffectivePlan`, `selectActiveBots`,
// `incrementMessageCount`, etc.). Bun's `mock.module` REPLACES the
// module's full export shape — if we omit those, downstream test files
// crash with "Export named X not found" on whatever order CI happens
// to run them in. Stub them all as harmless no-ops to keep the mock
// from leaking into a CI-only failure mode.
mock.module("../src/lib/owners", () => ({
  upsertOwnerProfile: (from: { id: number; is_bot?: boolean }): Promise<void> => {
    upsertCalls.push(from);
    return nextUpsertResult;
  },
  touchOwner: (_id: string): Promise<void> => Promise.resolve(),
  startTrialOnFirstBot: (_id: string): Promise<void> => Promise.resolve(),
  incrementBotCount: (_id: string): Promise<void> => Promise.resolve(),
  decrementBotCount: (_id: string): Promise<void> => Promise.resolve(),
  incrementDocCount: (_id: string): Promise<void> => Promise.resolve(),
  decrementDocCount: (_id: string): Promise<void> => Promise.resolve(),
  incrementMessageCount: (_id: string): Promise<void> => Promise.resolve(),
  decrementMessageCount: (_id: string): Promise<void> => Promise.resolve(),
  resetMessageCount: (_id: string, _at: Date): Promise<void> => Promise.resolve(),
  checkQuota: () =>
    Promise.resolve({
      ok: false,
      plan: null,
      used: 0,
      limit: 0,
      reason: "lapsed" as const,
    }),
  recomputeEffectivePlan: () =>
    Promise.resolve({ plan: null, status: "lapsed" as const }),
  selectActiveBots: <T,>(bots: T[]) => ({ active: bots, overQuota: [] as T[] }),
  enforceOwnerQuota: () => Promise.resolve({ paused: [] as string[] }),
  swapPrimaryBot: (_a: string, _b: string): Promise<void> => Promise.resolve(),
}));

// Import AFTER the mock so the middleware picks up the stub.
const { ownerCaptureMiddleware } = await import("../src/lib/owner-capture");

function makeCtx(from: { id: number; is_bot?: boolean } | undefined): Context {
  return { from } as unknown as Context;
}

describe("ownerCaptureMiddleware", () => {
  test("passes through to next()", async () => {
    upsertCalls.length = 0;
    nextUpsertResult = Promise.resolve();
    const mw = ownerCaptureMiddleware();
    let called = false;
    await mw(makeCtx(undefined), async () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  test("skips updates with no `from` user", async () => {
    upsertCalls.length = 0;
    nextUpsertResult = Promise.resolve();
    const mw = ownerCaptureMiddleware();
    await mw(makeCtx(undefined), async () => {});
    expect(upsertCalls).toEqual([]);
  });

  test("skips bot users", async () => {
    upsertCalls.length = 0;
    nextUpsertResult = Promise.resolve();
    const mw = ownerCaptureMiddleware();
    await mw(makeCtx({ id: 42, is_bot: true }), async () => {});
    expect(upsertCalls).toEqual([]);
  });

  test("upserts profile for human users", async () => {
    upsertCalls.length = 0;
    nextUpsertResult = Promise.resolve();
    const mw = ownerCaptureMiddleware();
    await mw(makeCtx({ id: 7, is_bot: false }), async () => {});
    // Let the fire-and-forget upsert resolve.
    await Promise.resolve();
    expect(upsertCalls).toEqual([{ id: 7, is_bot: false }]);
  });

  test("does not propagate upsert errors to the handler", async () => {
    upsertCalls.length = 0;
    nextUpsertResult = Promise.reject(new Error("db down"));
    const mw = ownerCaptureMiddleware();
    let nextCalled = false;
    // Must not throw even though upsertOwnerProfile rejected.
    await mw(makeCtx({ id: 9, is_bot: false }), async () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    // Drain the unhandled-rejection microtask so it doesn't leak.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    // Reset for any subsequent tests.
    nextUpsertResult = Promise.resolve();
  });
});
