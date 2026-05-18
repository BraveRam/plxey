import { describe, expect, test } from "bun:test";
import type { Context } from "grammy";
import type { User } from "grammy/types";
import { ownerCaptureMiddleware } from "../src/lib/owner-capture";

// Dependency-injected stubs. Avoid `bun:test`'s `mock.module` here —
// it registers a process-wide module replacement that leaks into every
// later test file in the same `bun test` run, and we tripped that on
// CI when other suites tried to import additional symbols from the
// real `lib/owners`.

function makeStubs(): {
  deps: {
    upsertOwnerProfile: (from: User) => Promise<void>;
    identifyOwner: (from: User) => void;
  };
  upsertCalls: User[];
  identifyCalls: User[];
  setNextUpsertResult: (p: Promise<void>) => void;
} {
  const upsertCalls: User[] = [];
  const identifyCalls: User[] = [];
  let nextUpsertResult: Promise<void> = Promise.resolve();
  return {
    deps: {
      upsertOwnerProfile: (from: User) => {
        upsertCalls.push(from);
        return nextUpsertResult;
      },
      identifyOwner: (from: User) => {
        identifyCalls.push(from);
      },
    },
    upsertCalls,
    identifyCalls,
    setNextUpsertResult: (p) => {
      nextUpsertResult = p;
    },
  };
}

function makeCtx(from: User | undefined): Context {
  return { from } as unknown as Context;
}

describe("ownerCaptureMiddleware", () => {
  test("passes through to next()", async () => {
    const { deps } = makeStubs();
    const mw = ownerCaptureMiddleware(deps);
    let called = false;
    await mw(makeCtx(undefined), async () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  test("skips updates with no `from` user", async () => {
    const { deps, upsertCalls } = makeStubs();
    const mw = ownerCaptureMiddleware(deps);
    await mw(makeCtx(undefined), async () => {});
    expect(upsertCalls).toEqual([]);
  });

  test("skips bot users", async () => {
    const { deps, upsertCalls } = makeStubs();
    const mw = ownerCaptureMiddleware(deps);
    await mw(makeCtx({ id: 42, is_bot: true } as User), async () => {});
    expect(upsertCalls).toEqual([]);
  });

  test("upserts profile for human users", async () => {
    const { deps, upsertCalls } = makeStubs();
    const mw = ownerCaptureMiddleware(deps);
    await mw(makeCtx({ id: 7, is_bot: false } as User), async () => {});
    // Let the fire-and-forget upsert resolve.
    await Promise.resolve();
    expect(upsertCalls).toEqual([{ id: 7, is_bot: false } as User]);
  });

  test("identifies the human user in analytics", async () => {
    const { deps, identifyCalls } = makeStubs();
    const mw = ownerCaptureMiddleware(deps);
    await mw(makeCtx({ id: 7, is_bot: false } as User), async () => {});
    expect(identifyCalls).toEqual([{ id: 7, is_bot: false } as User]);
  });

  test("does not propagate upsert errors to the handler", async () => {
    const { deps, setNextUpsertResult } = makeStubs();
    setNextUpsertResult(Promise.reject(new Error("db down")));
    const mw = ownerCaptureMiddleware(deps);
    let nextCalled = false;
    await mw(makeCtx({ id: 9, is_bot: false } as User), async () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    // Drain the unhandled-rejection microtask so it doesn't leak.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
});
