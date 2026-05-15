import { expect, test } from "bun:test";
import { InMemoryAdminReplyTargets } from "../src/bots/admin-reply-targets";
import { BotRegistry } from "../src/bots/registry";

test("registry can use an injected admin reply target store", () => {
  const registry = new BotRegistry(new InMemoryAdminReplyTargets(() => "token-a"));

  expect(registry.has("missing-bot")).toBe(false);
});
