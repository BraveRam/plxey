import { describe, expect, test } from "bun:test";
import {
  isWithinThresholdWindow,
  thresholdWindow,
} from "../../src/inngest/crons/_helpers";

const NOW = new Date("2026-05-17T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("thresholdWindow", () => {
  test("T-7d returns (now+6d, now+7d]", () => {
    const w = thresholdWindow(NOW, 7);
    expect(w.start.getTime()).toBe(NOW.getTime() + 6 * DAY);
    expect(w.end.getTime()).toBe(NOW.getTime() + 7 * DAY);
  });

  test("T-1d returns (now+0d, now+1d]", () => {
    const w = thresholdWindow(NOW, 1);
    expect(w.start.getTime()).toBe(NOW.getTime());
    expect(w.end.getTime()).toBe(NOW.getTime() + DAY);
  });

  test("T-3d returns (now+2d, now+3d]", () => {
    const w = thresholdWindow(NOW, 3);
    expect(w.start.getTime()).toBe(NOW.getTime() + 2 * DAY);
    expect(w.end.getTime()).toBe(NOW.getTime() + 3 * DAY);
  });
});

describe("isWithinThresholdWindow", () => {
  test("returns false for null/undefined", () => {
    expect(isWithinThresholdWindow(null, NOW, 7)).toBe(false);
    expect(isWithinThresholdWindow(undefined, NOW, 7)).toBe(false);
  });

  test("T-7d: a value at exactly now+7d (the end) matches", () => {
    const t = new Date(NOW.getTime() + 7 * DAY);
    expect(isWithinThresholdWindow(t, NOW, 7)).toBe(true);
  });

  test("T-7d: a value at exactly now+6d (the start) does NOT match (half-open)", () => {
    const t = new Date(NOW.getTime() + 6 * DAY);
    expect(isWithinThresholdWindow(t, NOW, 7)).toBe(false);
  });

  test("T-7d: a value strictly inside the 24h window matches", () => {
    const t = new Date(NOW.getTime() + 6.5 * DAY);
    expect(isWithinThresholdWindow(t, NOW, 7)).toBe(true);
  });

  test("T-7d: a value before now+6d (too early) does NOT match", () => {
    const t = new Date(NOW.getTime() + 5 * DAY);
    expect(isWithinThresholdWindow(t, NOW, 7)).toBe(false);
  });

  test("T-7d: a value past now+7d (too late) does NOT match", () => {
    const t = new Date(NOW.getTime() + 8 * DAY);
    expect(isWithinThresholdWindow(t, NOW, 7)).toBe(false);
  });

  test("T-1d: half-open windows don't double-count across consecutive scans", () => {
    // A trial_ends_at exactly at now+1d matches today's scan ...
    const t = new Date(NOW.getTime() + DAY);
    expect(isWithinThresholdWindow(t, NOW, 1)).toBe(true);

    // ... but a scan run 24h later, with the same trial_ends_at, falls
    // exactly on the start boundary of T-0 window — half-open semantics
    // mean it does NOT match the T-1d window at that later tick.
    const tomorrowNow = new Date(NOW.getTime() + DAY);
    expect(isWithinThresholdWindow(t, tomorrowNow, 1)).toBe(false);
  });
});
