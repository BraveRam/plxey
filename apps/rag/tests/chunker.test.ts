import { expect, test, describe } from "bun:test";
import { splitText, stripLoneSurrogates } from "../src/chunker";

const hasLoneSurrogate = (s: string): boolean =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

describe("stripLoneSurrogates", () => {
  test("leaves a well-formed surrogate pair (emoji) intact", () => {
    const emoji = "😀"; // U+1F600 — one surrogate pair
    expect(stripLoneSurrogates(`hi ${emoji} there`)).toBe(`hi ${emoji} there`);
  });

  test("removes a lone high surrogate (split emoji, leading half)", () => {
    const loneHigh = "\uD83D"; // high half of 😀 with no low half
    expect(stripLoneSurrogates(`a${loneHigh}b`)).toBe("ab");
  });

  test("removes a lone low surrogate (split emoji, trailing half)", () => {
    const loneLow = "\uDE00"; // low half of 😀 with no high half
    expect(stripLoneSurrogates(`a${loneLow}b`)).toBe("ab");
  });

  test("leaves plain text untouched", () => {
    expect(stripLoneSurrogates("Hello, world.")).toBe("Hello, world.");
  });
});

describe("chunker never emits lone surrogates", () => {
  test("emoji-dense text split small produces only well-formed chunks", () => {
    // Force the splitter through its overlap + char-level passes on text
    // packed with surrogate-pair emoji, so a naive code-unit slice would
    // cut a pair. Every resulting chunk must be well-formed.
    const text = "😀😃😄😁😆😅😂🤣😊😇🙂🙃😉😌😍🥰😘".repeat(20);
    const chunks = splitText(text, { size: 25, overlap: 7 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(hasLoneSurrogate(c)).toBe(false);
    }
  });
});

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
