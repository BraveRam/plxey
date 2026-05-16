import { describe, expect, test } from "bun:test";
import {
  detectMimeType,
  isSupportedDocumentType,
  SUPPORTED_DOCUMENT_TYPES,
} from "../src/bots/document-types";

describe("detectMimeType", () => {
  test("returns the explicit mime when it's a supported type", () => {
    expect(detectMimeType("file.pdf", "application/pdf")).toBe("application/pdf");
  });

  test("falls back to extension when mime is octet-stream (common on mobile)", () => {
    expect(detectMimeType("notes.md", "application/octet-stream")).toBe(
      "text/markdown",
    );
  });

  test("falls back to extension when mime is missing entirely", () => {
    expect(detectMimeType("kb.docx", undefined)).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  test("recognizes .txt", () => {
    expect(detectMimeType("readme.txt", undefined)).toBe("text/plain");
  });

  test("recognizes both .html and .htm", () => {
    expect(detectMimeType("page.html", undefined)).toBe("text/html");
    expect(detectMimeType("page.htm", undefined)).toBe("text/html");
  });

  test("recognizes .markdown as well as .md", () => {
    expect(detectMimeType("README.markdown", undefined)).toBe("text/markdown");
  });

  test("extension matching is case-insensitive", () => {
    expect(detectMimeType("README.MD", undefined)).toBe("text/markdown");
    expect(detectMimeType("doc.PDF", undefined)).toBe("application/pdf");
  });

  test("returns null when both mime and extension are unsupported", () => {
    expect(detectMimeType("photo.png", "image/png")).toBeNull();
  });

  test("returns null when no fileName and unknown mime", () => {
    expect(detectMimeType(undefined, undefined)).toBeNull();
  });

  test("returns null for a fileName with no extension", () => {
    expect(detectMimeType("README", undefined)).toBeNull();
  });
});

describe("isSupportedDocumentType", () => {
  test("accepts every type in the v1 set", () => {
    for (const mime of SUPPORTED_DOCUMENT_TYPES) {
      expect(isSupportedDocumentType(mime)).toBe(true);
    }
  });

  test("rejects unrelated mimes", () => {
    expect(isSupportedDocumentType("image/png")).toBe(false);
    expect(isSupportedDocumentType("application/zip")).toBe(false);
  });
});
