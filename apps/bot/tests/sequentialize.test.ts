import { describe, expect, test } from "bun:test";
import type { Context } from "grammy";
import { sequentializeByChat } from "../src/lib/sequentialize";

function makeCtx(chatId: number | undefined): Context {
  return { chat: chatId === undefined ? undefined : { id: chatId } } as unknown as Context;
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("sequentializeByChat", () => {
  test("serializes two updates from the same chat", async () => {
    const middleware = sequentializeByChat();
    const order: string[] = [];
    const firstGate = deferred();

    const first = middleware(makeCtx(1), async () => {
      order.push("first-start");
      await firstGate.promise;
      order.push("first-end");
    });

    // Let the first middleware enqueue itself before scheduling the second.
    await Promise.resolve();

    const second = middleware(makeCtx(1), async () => {
      order.push("second-start");
      order.push("second-end");
    });

    // Give the event loop a chance — second must not have started yet.
    await Promise.resolve();
    expect(order).toEqual(["first-start"]);

    firstGate.resolve();
    await Promise.all([first, second]);

    expect(order).toEqual([
      "first-start",
      "first-end",
      "second-start",
      "second-end",
    ]);
  });

  test("updates from different chats run concurrently", async () => {
    const middleware = sequentializeByChat();
    const order: string[] = [];
    const chatA = deferred();
    const chatB = deferred();

    const a = middleware(makeCtx(1), async () => {
      order.push("a-start");
      await chatA.promise;
      order.push("a-end");
    });

    const b = middleware(makeCtx(2), async () => {
      order.push("b-start");
      await chatB.promise;
      order.push("b-end");
    });

    await Promise.resolve();
    await Promise.resolve();
    // Both should have started — they're in different chats.
    expect(order.sort()).toEqual(["a-start", "b-start"]);

    chatB.resolve();
    chatA.resolve();
    await Promise.all([a, b]);

    expect(order).toContain("a-end");
    expect(order).toContain("b-end");
  });

  test("a failing first update does not block the second", async () => {
    const middleware = sequentializeByChat();
    const order: string[] = [];

    const first = middleware(makeCtx(1), async () => {
      order.push("first");
      throw new Error("boom");
    });

    await Promise.resolve();

    const second = middleware(makeCtx(1), async () => {
      order.push("second");
    });

    await Promise.allSettled([first, second]);

    expect(order).toEqual(["first", "second"]);
  });

  test("updates without a chat fall through immediately", async () => {
    const middleware = sequentializeByChat();
    const order: string[] = [];
    const gate = deferred();

    // A long-running update without chat must not block another.
    const blocking = middleware(makeCtx(undefined), async () => {
      order.push("blocking-start");
      await gate.promise;
      order.push("blocking-end");
    });

    await Promise.resolve();

    const other = middleware(makeCtx(undefined), async () => {
      order.push("other");
    });

    await Promise.resolve();
    await Promise.resolve();
    // Both started — no chat means no queue.
    expect(order).toContain("blocking-start");
    expect(order).toContain("other");

    gate.resolve();
    await Promise.all([blocking, other]);
  });

  test("three updates from the same chat run strictly in order", async () => {
    const middleware = sequentializeByChat();
    const order: string[] = [];
    const gates = [deferred(), deferred(), deferred()];

    const runs = [0, 1, 2].map((i) =>
      middleware(makeCtx(99), async () => {
        order.push(`start-${i}`);
        await gates[i]!.promise;
        order.push(`end-${i}`);
      }),
    );

    // Release them in reverse to prove the queue holds order even if the
    // downstream handlers would finish in a different order.
    await Promise.resolve();
    gates[2]!.resolve();
    gates[1]!.resolve();
    gates[0]!.resolve();
    await Promise.all(runs);

    expect(order).toEqual([
      "start-0",
      "end-0",
      "start-1",
      "end-1",
      "start-2",
      "end-2",
    ]);
  });
});
