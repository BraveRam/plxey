import { describe, expect, test, mock } from "bun:test";
import type { Context } from "grammy";

// Stub the owners module before importing the middleware so we don't
// touch the real upsertOwnerProfile (which talks to the DB). The
// parallel Phase 2a agent owns `lib/owners.ts`; we test the middleware
// in isolation against the contract.
const upsertCalls: Array<{ id: number; is_bot?: boolean }> = [];
let nextUpsertResult: Promise<void> = Promise.resolve();

mock.module("../src/lib/owners", () => ({
  upsertOwnerProfile: (from: { id: number; is_bot?: boolean }): Promise<void> => {
    upsertCalls.push(from);
    return nextUpsertResult;
  },
  touchOwner: (_id: string): Promise<void> => Promise.resolve(),
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
