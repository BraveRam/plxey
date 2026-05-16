import { describe, expect, test } from "bun:test";
import {
  checkDocumentLimits,
  formatBytes,
  MAX_DOCUMENT_SIZE_BYTES,
  MAX_DOCUMENTS_PER_BOT,
} from "../src/bots/document-limits";

describe("formatBytes", () => {
  test("renders byte counts under 1 KB as plain bytes", () => {
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(512)).toBe("512 bytes");
  });

  test("renders 1024+ as KB with one decimal", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  test("renders 1 MB+ as MB with one decimal", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(7 * 1024 * 1024 + 512 * 1024)).toBe("7.5 MB");
  });
});

describe("MAX_DOCUMENT_SIZE_BYTES + MAX_DOCUMENTS_PER_BOT", () => {
  test("constants match the product spec (5 MB / 3 docs)", () => {
    expect(MAX_DOCUMENT_SIZE_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_DOCUMENTS_PER_BOT).toBe(3);
  });
});

describe("checkDocumentLimits", () => {
  test("accepts a small file under the count limit", () => {
    expect(
      checkDocumentLimits({ fileSize: 1024, currentDocCount: 0 }),
    ).toEqual({ ok: true });
    expect(
      checkDocumentLimits({ fileSize: 1024, currentDocCount: 2 }),
    ).toEqual({ ok: true });
  });

  test("accepts a file exactly at the size limit", () => {
    expect(
      checkDocumentLimits({
        fileSize: MAX_DOCUMENT_SIZE_BYTES,
        currentDocCount: 0,
      }),
    ).toEqual({ ok: true });
  });

  test("rejects when the bot already has the max number of docs", () => {
    expect(
      checkDocumentLimits({ fileSize: 1024, currentDocCount: 3 }),
    ).toEqual({
      ok: false,
      reason: "too_many",
      count: 3,
      limit: MAX_DOCUMENTS_PER_BOT,
    });
  });

  test("rejects when count is already over the cap (defense in depth)", () => {
    expect(
      checkDocumentLimits({ fileSize: 1024, currentDocCount: 4 }),
    ).toEqual({
      ok: false,
      reason: "too_many",
      count: 4,
      limit: MAX_DOCUMENTS_PER_BOT,
    });
  });

  test("rejects a file one byte over the size limit", () => {
    expect(
      checkDocumentLimits({
        fileSize: MAX_DOCUMENT_SIZE_BYTES + 1,
        currentDocCount: 0,
      }),
    ).toEqual({
      ok: false,
      reason: "too_large",
      size: MAX_DOCUMENT_SIZE_BYTES + 1,
      limit: MAX_DOCUMENT_SIZE_BYTES,
    });
  });

  test("rejects when size is unknown — we can't verify, so we refuse", () => {
    expect(
      checkDocumentLimits({ fileSize: undefined, currentDocCount: 0 }),
    ).toEqual({
      ok: false,
      reason: "too_large",
      size: 0,
      limit: MAX_DOCUMENT_SIZE_BYTES,
    });
  });

  test("count check fires before size check when both fail", () => {
    // Helps the user — if they're at the cap they need to delete first
    // regardless of whether the file is big.
    expect(
      checkDocumentLimits({
        fileSize: MAX_DOCUMENT_SIZE_BYTES + 1000,
        currentDocCount: 3,
      }),
    ).toEqual({
      ok: false,
      reason: "too_many",
      count: 3,
      limit: MAX_DOCUMENTS_PER_BOT,
    });
  });
});
