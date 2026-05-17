import { describe, expect, test } from "bun:test";
import { selectActiveBots, type QuotaSelectionBot } from "../src/lib/owners";

const NOW = new Date("2026-05-17T12:00:00.000Z");

function ms(date: Date, deltaDays: number): Date {
  return new Date(date.getTime() + deltaDays * 24 * 60 * 60 * 1000);
}

function bot(
  partial: Partial<QuotaSelectionBot> & Pick<QuotaSelectionBot, "id">,
): QuotaSelectionBot {
  return {
    createdAt: NOW,
    lastActiveAt: null,
    currentlyOverQuota: false,
    ...partial,
  };
}

describe("selectActiveBots", () => {
  test("returns all bots active when count <= maxActive", () => {
    const bots = [
      bot({ id: "a", lastActiveAt: ms(NOW, -1) }),
      bot({ id: "b", lastActiveAt: ms(NOW, -2) }),
      bot({ id: "c", lastActiveAt: ms(NOW, -3) }),
    ];

    const result = selectActiveBots(bots, 5);

    expect(result.active.sort()).toEqual(["a", "b", "c"]);
    expect(result.overQuota).toEqual([]);
  });

  test("returns all bots active when count == maxActive exactly", () => {
    const bots = [
      bot({ id: "a", lastActiveAt: ms(NOW, -1) }),
      bot({ id: "b", lastActiveAt: ms(NOW, -2) }),
      bot({ id: "c", lastActiveAt: ms(NOW, -3) }),
    ];

    const result = selectActiveBots(bots, 3);

    expect(result.active.sort()).toEqual(["a", "b", "c"]);
    expect(result.overQuota).toEqual([]);
  });

  test("returns empty result when given no bots", () => {
    expect(selectActiveBots([], 3)).toEqual({ active: [], overQuota: [] });
  });

  test("keeps the most-recently-active bot when truncating", () => {
    const bots = [
      bot({ id: "old", lastActiveAt: ms(NOW, -10) }),
      bot({ id: "newer", lastActiveAt: ms(NOW, -1) }),
      bot({ id: "mid", lastActiveAt: ms(NOW, -5) }),
    ];

    const result = selectActiveBots(bots, 1);

    expect(result.active).toEqual(["newer"]);
    expect(result.overQuota.sort()).toEqual(["mid", "old"]);
  });

  test("tiebreaks equal lastActiveAt by oldest createdAt (older wins active slot)", () => {
    const sameActivity = ms(NOW, -1);
    const bots = [
      bot({ id: "younger", createdAt: ms(NOW, -5), lastActiveAt: sameActivity }),
      bot({ id: "older", createdAt: ms(NOW, -30), lastActiveAt: sameActivity }),
    ];

    const result = selectActiveBots(bots, 1);

    // Older createdAt wins the tiebreak.
    expect(result.active).toEqual(["older"]);
    expect(result.overQuota).toEqual(["younger"]);
  });

  test("treats lastActiveAt=null as least recent", () => {
    const bots = [
      bot({ id: "neverTalked", lastActiveAt: null }),
      bot({ id: "talked", lastActiveAt: ms(NOW, -100) }),
    ];

    const result = selectActiveBots(bots, 1);

    expect(result.active).toEqual(["talked"]);
    expect(result.overQuota).toEqual(["neverTalked"]);
  });

  test("orders null lastActiveAt by oldest createdAt when otherwise tied", () => {
    const bots = [
      bot({ id: "newish", createdAt: ms(NOW, -1), lastActiveAt: null }),
      bot({ id: "ancient", createdAt: ms(NOW, -30), lastActiveAt: null }),
    ];

    const result = selectActiveBots(bots, 1);

    // Both null lastActiveAt; oldest createdAt wins.
    expect(result.active).toEqual(["ancient"]);
    expect(result.overQuota).toEqual(["newish"]);
  });

  test("when fully tied, prefers keeping currently-active bots to minimize churn", () => {
    const sharedCreated = ms(NOW, -10);
    const bots = [
      bot({
        id: "currentlyPaused",
        createdAt: sharedCreated,
        lastActiveAt: null,
        currentlyOverQuota: true,
      }),
      bot({
        id: "currentlyActive",
        createdAt: sharedCreated,
        lastActiveAt: null,
        currentlyOverQuota: false,
      }),
    ];

    const result = selectActiveBots(bots, 1);

    // With everything else equal, the currently-active bot wins the slot.
    expect(result.active).toEqual(["currentlyActive"]);
    expect(result.overQuota).toEqual(["currentlyPaused"]);
  });

  test("currentlyOverQuota does NOT override a more-recent lastActiveAt", () => {
    const bots = [
      bot({
        id: "paused-but-recent",
        lastActiveAt: ms(NOW, -1),
        currentlyOverQuota: true,
      }),
      bot({
        id: "active-but-stale",
        lastActiveAt: ms(NOW, -30),
        currentlyOverQuota: false,
      }),
    ];

    const result = selectActiveBots(bots, 1);

    // Most-recently-active wins; the currentlyOverQuota flag is only a
    // tiebreak.
    expect(result.active).toEqual(["paused-but-recent"]);
    expect(result.overQuota).toEqual(["active-but-stale"]);
  });

  test("maxActive=0 forces every bot over-quota (lapsed/banned path)", () => {
    const bots = [
      bot({ id: "a", lastActiveAt: ms(NOW, -1) }),
      bot({ id: "b", lastActiveAt: ms(NOW, -2) }),
      bot({ id: "c", lastActiveAt: ms(NOW, -3) }),
    ];

    const result = selectActiveBots(bots, 0);

    expect(result.active).toEqual([]);
    expect(result.overQuota.sort()).toEqual(["a", "b", "c"]);
  });

  test("negative maxActive behaves like 0", () => {
    const bots = [bot({ id: "a", lastActiveAt: ms(NOW, -1) })];
    const result = selectActiveBots(bots, -3);
    expect(result.active).toEqual([]);
    expect(result.overQuota).toEqual(["a"]);
  });

  test("maxActive=1 with 5 bots picks exactly one", () => {
    const bots = [
      bot({ id: "1", lastActiveAt: ms(NOW, -5) }),
      bot({ id: "2", lastActiveAt: ms(NOW, -4) }),
      bot({ id: "3", lastActiveAt: ms(NOW, -3) }),
      bot({ id: "4", lastActiveAt: ms(NOW, -2) }),
      bot({ id: "5", lastActiveAt: ms(NOW, -1) }),
    ];

    const result = selectActiveBots(bots, 1);

    expect(result.active).toEqual(["5"]);
    expect(result.overQuota.length).toBe(4);
    expect(result.overQuota.sort()).toEqual(["1", "2", "3", "4"]);
  });

  test("does not mutate its input array", () => {
    const bots: QuotaSelectionBot[] = [
      bot({ id: "a", lastActiveAt: ms(NOW, -3) }),
      bot({ id: "b", lastActiveAt: ms(NOW, -1) }),
      bot({ id: "c", lastActiveAt: ms(NOW, -2) }),
    ];
    const snapshot = bots.map((b) => b.id);

    selectActiveBots(bots, 1);

    expect(bots.map((b) => b.id)).toEqual(snapshot);
  });

  test("mixed: keeps recently-active, deprioritizes null-lastActiveAt at cap edge", () => {
    const bots = [
      bot({ id: "talkative", lastActiveAt: ms(NOW, -1) }),
      bot({ id: "quiet", lastActiveAt: null }),
      bot({ id: "old-talker", lastActiveAt: ms(NOW, -30) }),
    ];

    const result = selectActiveBots(bots, 2);

    expect(result.active).toEqual(["talkative", "old-talker"]);
    expect(result.overQuota).toEqual(["quiet"]);
  });
});
