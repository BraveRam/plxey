import { describe, expect, test } from "bun:test";
import { parseIncomingMessage } from "../src/lib/business-input";

describe("parseIncomingMessage", () => {
  test("text-only message", () => {
    expect(parseIncomingMessage({ text: "hello" })).toEqual({
      text: "hello",
      photoFileId: null,
    });
  });

  test("photo + caption → largest file_id + caption text", () => {
    expect(
      parseIncomingMessage({
        caption: "look at this",
        photo: [{ file_id: "s" }, { file_id: "m" }, { file_id: "l" }],
      }),
    ).toEqual({ text: "look at this", photoFileId: "l" });
  });

  test("photo with no caption → empty text + file_id", () => {
    expect(parseIncomingMessage({ photo: [{ file_id: "only" }] })).toEqual({
      text: "",
      photoFileId: "only",
    });
  });

  test("trims surrounding whitespace on text/caption", () => {
    expect(parseIncomingMessage({ text: "  hi  " })).toEqual({
      text: "hi",
      photoFileId: null,
    });
  });

  test("unsupported media (no text, no photo) → empty/null", () => {
    expect(parseIncomingMessage({})).toEqual({ text: "", photoFileId: null });
  });

  test("text takes precedence over caption when both present", () => {
    expect(parseIncomingMessage({ text: "t", caption: "c" })).toEqual({
      text: "t",
      photoFileId: null,
    });
  });

  test("empty photo array is treated as no photo", () => {
    expect(parseIncomingMessage({ text: "hi", photo: [] })).toEqual({
      text: "hi",
      photoFileId: null,
    });
  });
});
