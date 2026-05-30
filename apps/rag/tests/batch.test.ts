import { describe, expect, test } from "bun:test";
import { batchRows } from "../src/batch";

// batchRows splits a flat array into fixed-size slices, tagging each with its
// global start index — so ingest can embed + insert chunks in bounded batches
// while still computing the right chunk_index per row.

describe("batchRows", () => {
  test("splits into full batches with correct start offsets", () => {
    const out = batchRows([0, 1, 2, 3], 2);
    expect(out).toEqual([
      { start: 0, slice: [0, 1] },
      { start: 2, slice: [2, 3] },
    ]);
  });

  test("keeps a short final batch (remainder)", () => {
    const out = batchRows([0, 1, 2, 3, 4], 2);
    expect(out).toEqual([
      { start: 0, slice: [0, 1] },
      { start: 2, slice: [2, 3] },
      { start: 4, slice: [4] },
    ]);
  });

  test("a batch larger than the input yields one slice", () => {
    expect(batchRows(["a", "b"], 50)).toEqual([{ start: 0, slice: ["a", "b"] }]);
  });

  test("empty input yields no batches", () => {
    expect(batchRows([], 50)).toEqual([]);
  });

  test("size of 1 yields one batch per item with ascending starts", () => {
    expect(batchRows(["a", "b", "c"], 1)).toEqual([
      { start: 0, slice: ["a"] },
      { start: 1, slice: ["b"] },
      { start: 2, slice: ["c"] },
    ]);
  });

  test("global start index lets callers recover the original chunk index", () => {
    const items = Array.from({ length: 125 }, (_, i) => i);
    const recovered = batchRows(items, 50).flatMap(({ start, slice }) =>
      slice.map((_, j) => start + j),
    );
    expect(recovered).toEqual(items);
  });

  test("rejects a non-positive or non-integer batch size", () => {
    expect(() => batchRows([1], 0)).toThrow();
    expect(() => batchRows([1], -1)).toThrow();
    expect(() => batchRows([1], 1.5)).toThrow();
  });
});
