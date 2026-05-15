import { expect, test, describe } from "bun:test";
import { splitText } from "../src/chunker";

describe("chunker", () => {
  test("returns empty array for empty string", () => {
    expect(splitText("")).toEqual([]);
  });

  test("returns single chunk for short text", () => {
    const text = "Hello world.";
    expect(splitText(text)).toEqual([text]);
  });

  test("splits by paragraph breaks first", () => {
    const a = "A".repeat(100);
    const b = "B".repeat(100);
    const text = `${a}\n\n${b}`;
    const result = splitText(text, { size: 150, overlap: 0 });
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("A");
    expect(result[1]).toContain("B");
  });

  test("splits by sentences when paragraph too large", () => {
    const a = "A".repeat(200);
    const b = "B".repeat(200);
    const text = `${a}. ${b}.`;
    const result = splitText(text, { size: 250, overlap: 0 });
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("A");
    expect(result[1]).toContain("B");
  });

  test("applies overlap between chunks", () => {
    const a = "A".repeat(100);
    const b = "B".repeat(100);
    const text = `${a}. ${b}.`;
    const result = splitText(text, { size: 150, overlap: 30 });
    expect(result).toHaveLength(2);
    expect(result[1]!).toStartWith(result[0]!.slice(-30));
  });

  test("handles text without separators", () => {
    const text = "A".repeat(1000);
    const result = splitText(text, { size: 200, overlap: 0 });
    expect(result.length).toBeGreaterThan(1);
  });

  test("handles single long word", () => {
    const text = "A".repeat(1000);
    const result = splitText(text, { size: 100, overlap: 0 });
    expect(result.every(c => c.length <= 100)).toBe(true);
  });

  test("default options use 500 size and 50 overlap", () => {
    const text = `${"A".repeat(300)}\n\n${"B".repeat(300)}`;
    const result = splitText(text);
    expect(result).toHaveLength(2);
    expect(result[1]!).toStartWith(result[0]!.slice(-50));
  });
});
