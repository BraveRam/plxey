import { describe, expect, test } from "bun:test";
import { inngest } from "../src/inngest/client";
import { functions } from "../src/inngest/functions";

describe("inngest client", () => {
  test("has a distinct id from the rag worker", () => {
    expect(inngest.id).toBe("tg-business-bot");
    expect(inngest.id).not.toBe("tg-rag");
  });

  test("functions registry starts empty — phases append later", () => {
    expect(functions).toEqual([]);
  });
});
