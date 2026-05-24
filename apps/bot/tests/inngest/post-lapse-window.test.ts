import { describe, expect, test } from "bun:test";
import { postLapseWindow } from "../../src/inngest/crons/reminder-scan";

const NOW = new Date("2026-05-17T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("postLapseWindow — T+Nd post-lapse band", () => {
  test("T+3 returns (now-3d, now-2d]", () => {
    const w = postLapseWindow(NOW, 3);
    expect(w.start.getTime()).toBe(NOW.getTime() - 3 * DAY);
    expect(w.end.getTime()).toBe(NOW.getTime() - 2 * DAY);
  });

  test("T+14 returns (now-14d, now-13d]", () => {
    const w = postLapseWindow(NOW, 14);
    expect(w.start.getTime()).toBe(NOW.getTime() - 14 * DAY);
    expect(w.end.getTime()).toBe(NOW.getTime() - 13 * DAY);
  });

  test("T+1 returns (now-1d, now]", () => {
    const w = postLapseWindow(NOW, 1);
    expect(w.start.getTime()).toBe(NOW.getTime() - DAY);
    expect(w.end.getTime()).toBe(NOW.getTime());
  });

  test("a lapse anchor at exactly now-2d is the upper bound of T+3", () => {
    const w = postLapseWindow(NOW, 3);
    const anchor = new Date(NOW.getTime() - 2 * DAY);
    expect(anchor.getTime()).toBe(w.end.getTime());
    expect(anchor.getTime() > w.start.getTime()).toBe(true);
    expect(anchor.getTime() <= w.end.getTime()).toBe(true);
  });

  test("a lapse anchor at exactly now-3d is excluded from T+3 (half-open lower)", () => {
    const w = postLapseWindow(NOW, 3);
    const anchor = new Date(NOW.getTime() - 3 * DAY);
    expect(anchor.getTime() > w.start.getTime()).toBe(false);
  });
});
