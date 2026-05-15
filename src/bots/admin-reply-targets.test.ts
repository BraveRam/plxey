import { expect, test } from "bun:test";
import { createReplyCallbackData, InMemoryAdminReplyTargets } from "./admin-reply-targets";

test("reply callback data contains only a short lookup token", () => {
  expect(createReplyCallbackData("abc123")).toBe("oreply_abc123");
});

test("admin reply target is selected by the pressed callback token", async () => {
  const targets = new InMemoryAdminReplyTargets(() => "token-a");
  const first = await targets.create({ botId: "bot-1", chatId: 111, businessConnectionId: "conn-a" });

  targets.setTokenFactory(() => "token-b");
  const second = await targets.create({ botId: "bot-1", chatId: 222, businessConnectionId: "conn-b" });

  expect(first).toBe("token-a");
  expect(second).toBe("token-b");

  expect(await targets.activate("admin-1", second)).toEqual({
    token: "token-b",
    botId: "bot-1",
    chatId: 222,
    businessConnectionId: "conn-b",
  });
  expect(await targets.getActive("admin-1")).toEqual({
    token: "token-b",
    botId: "bot-1",
    chatId: 222,
    businessConnectionId: "conn-b",
  });
});

test("active target survives store re-instantiation when storage is shared", async () => {
  const storage = new Map();
  const firstStore = new InMemoryAdminReplyTargets(() => "durable-token", storage);
  const token = await firstStore.create({ botId: "bot-1", chatId: 333, businessConnectionId: "conn-c" });
  await firstStore.activate("admin-1", token);

  const restartedStore = new InMemoryAdminReplyTargets(() => "unused", storage);

  expect(await restartedStore.getActive("admin-1")).toEqual({
    token: "durable-token",
    botId: "bot-1",
    chatId: 333,
    businessConnectionId: "conn-c",
  });
});

test("activating a new target clears the previous active target for that admin", async () => {
  const targets = new InMemoryAdminReplyTargets(() => "token-a");
  const first = await targets.create({ botId: "bot-1", chatId: 111, businessConnectionId: "conn-a" });

  targets.setTokenFactory(() => "token-b");
  const second = await targets.create({ botId: "bot-1", chatId: 222, businessConnectionId: "conn-b" });

  await targets.activate("admin-1", first);
  await targets.activate("admin-1", second);
  await targets.markUsed(second);

  expect(await targets.getActive("admin-1")).toBeNull();
});
