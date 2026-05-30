import { describe, expect, test, afterEach } from "bun:test";
import { selectModel, buildUserContent } from "../src/services/ai";

describe("selectModel", () => {
  const origModel = process.env.AI_MODEL;
  const origBiz = process.env.AI_MODEL_BUSINESS;

  afterEach(() => {
    if (origModel === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = origModel;
    if (origBiz === undefined) delete process.env.AI_MODEL_BUSINESS;
    else process.env.AI_MODEL_BUSINESS = origBiz;
  });

  test("business plan defaults to gemini-2.5-flash-lite", () => {
    delete process.env.AI_MODEL_BUSINESS;
    expect(selectModel("business")).toBe("google/gemini-2.5-flash-lite");
  });

  test("business plan honors AI_MODEL_BUSINESS override", () => {
    process.env.AI_MODEL_BUSINESS = "google/gemini-2.5-pro";
    expect(selectModel("business")).toBe("google/gemini-2.5-pro");
  });

  test("non-business plans use the AI_MODEL default", () => {
    delete process.env.AI_MODEL;
    expect(selectModel("pro")).toBe("deepseek/deepseek-v4-flash");
    expect(selectModel("trial")).toBe("deepseek/deepseek-v4-flash");
    expect(selectModel(null)).toBe("deepseek/deepseek-v4-flash");
  });

  test("non-business honors AI_MODEL; business path is independent of it", () => {
    process.env.AI_MODEL = "openai/gpt-x";
    delete process.env.AI_MODEL_BUSINESS;
    expect(selectModel("pro")).toBe("openai/gpt-x");
    expect(selectModel("business")).toBe("google/gemini-2.5-flash-lite");
  });
});

describe("buildUserContent", () => {
  test("no image → plain string content", () => {
    expect(buildUserContent("what are your hours?")).toBe("what are your hours?");
  });

  test("with image → [text, image] parts carrying raw bytes + mediaType", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(
      buildUserContent("what is this?", { bytes, mediaType: "image/jpeg" }),
    ).toEqual([
      { type: "text", text: "what is this?" },
      { type: "image", image: bytes, mediaType: "image/jpeg" },
    ]);
  });

  test("image with empty caption → non-empty fallback text part", () => {
    const bytes = new Uint8Array([9]);
    const out = buildUserContent("   ", { bytes, mediaType: "image/png" }) as Array<{
      type: string;
      text?: string;
      image?: unknown;
      mediaType?: string;
    }>;
    expect(out[0]!.type).toBe("text");
    expect((out[0]!.text ?? "").trim().length).toBeGreaterThan(0);
    expect(out[1]).toEqual({ type: "image", image: bytes, mediaType: "image/png" });
  });
});
