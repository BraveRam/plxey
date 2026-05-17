import { describe, expect, test } from "bun:test";
import { inngest } from "../src/inngest/client";
import { functions } from "../src/inngest/functions";

describe("inngest client", () => {
  test("has a distinct id from the rag worker", () => {
    expect(inngest.id).toBe("tg-business-bot");
    expect(inngest.id).not.toBe("tg-rag");
  });

  test("functions registry has cron sweeps + lifecycle handlers wired", () => {
    // 4 crons (lapse-sweep, trial-sweep, reminder-scan, usage-reconcile)
    // + 10 handlers (5 subscription/*, 2 owner/*, 2 bot/*, 1 notify/owner)
    expect(functions.length).toBeGreaterThanOrEqual(14);
  });
});
