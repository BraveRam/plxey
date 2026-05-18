import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  _resetForTests,
  customerDistinctId,
  flush,
  identifyBotGroup,
  identifyCustomer,
  identifyOwner,
  ownerDistinctId,
  track,
} from "../src/lib/analytics";

const ORIGINAL_TOKEN = process.env.POSTHOG_PROJECT_TOKEN;
const ORIGINAL_HOST = process.env.POSTHOG_HOST;

beforeEach(() => {
  _resetForTests();
});

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.POSTHOG_PROJECT_TOKEN;
  else process.env.POSTHOG_PROJECT_TOKEN = ORIGINAL_TOKEN;
  if (ORIGINAL_HOST === undefined) delete process.env.POSTHOG_HOST;
  else process.env.POSTHOG_HOST = ORIGINAL_HOST;
  _resetForTests();
});

describe("distinct id prefixing", () => {
  test("owners get the 'owner:' prefix", () => {
    expect(ownerDistinctId(1234)).toBe("owner:1234");
    expect(ownerDistinctId("99")).toBe("owner:99");
  });

  test("customers get the 'customer:' prefix", () => {
    expect(customerDistinctId(1234)).toBe("customer:1234");
    expect(customerDistinctId("99")).toBe("customer:99");
  });

  test("an owner and customer with the same Telegram id are distinct", () => {
    expect(ownerDistinctId(1234)).not.toBe(customerDistinctId(1234));
  });
});

describe("token-unset = no-op", () => {
  test("track does nothing and does not throw", () => {
    delete process.env.POSTHOG_PROJECT_TOKEN;
    // No throw is the assertion.
    track("owner:1", "test.event", { foo: 1 });
  });

  test("identifyOwner does nothing and does not throw", () => {
    delete process.env.POSTHOG_PROJECT_TOKEN;
    identifyOwner({
      id: 1,
      is_bot: false,
      first_name: "Alex",
    } as Parameters<typeof identifyOwner>[0]);
  });

  test("identifyCustomer does nothing and does not throw", () => {
    delete process.env.POSTHOG_PROJECT_TOKEN;
    identifyCustomer(
      { id: 1, is_bot: false, first_name: "Cust" } as Parameters<
        typeof identifyCustomer
      >[0],
      "bot-uuid",
    );
  });

  test("identifyBotGroup does nothing and does not throw", () => {
    delete process.env.POSTHOG_PROJECT_TOKEN;
    identifyBotGroup("bot-uuid", {
      botUsername: "supportbot",
      ownerTelegramUserId: "1",
      tenantId: "tenant-uuid",
    });
  });

  test("flush resolves immediately", async () => {
    delete process.env.POSTHOG_PROJECT_TOKEN;
    await flush();
  });
});
