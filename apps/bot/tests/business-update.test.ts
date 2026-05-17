import { expect, test } from "bun:test";
import type { Update } from "grammy/types";
import { isBusinessChatUpdate } from "../src/lib/business-update";

function asUpdate(partial: Partial<Update>): Update {
  return { update_id: 1, ...partial } as Update;
}

test("business_message updates are flagged as business-chat traffic", () => {
  expect(
    isBusinessChatUpdate(
      asUpdate({
        business_message: {
          message_id: 1,
          date: 0,
          chat: { id: 1, type: "private", first_name: "x" },
          business_connection_id: "bc-1",
        } as Update["business_message"],
      }),
    ),
  ).toBe(true);
});

test("edited_business_message is also business-chat traffic", () => {
  expect(
    isBusinessChatUpdate(
      asUpdate({ edited_business_message: { message_id: 1 } as Update["edited_business_message"] }),
    ),
  ).toBe(true);
});

test("business_connection events are business-chat traffic", () => {
  expect(
    isBusinessChatUpdate(
      asUpdate({ business_connection: { id: "bc-1" } as Update["business_connection"] }),
    ),
  ).toBe(true);
});

test("deleted_business_messages is business-chat traffic", () => {
  expect(
    isBusinessChatUpdate(
      asUpdate({
        deleted_business_messages: { business_connection_id: "bc-1" } as Update["deleted_business_messages"],
      }),
    ),
  ).toBe(true);
});

test("a regular DM message is not business-chat traffic (owner-side)", () => {
  expect(
    isBusinessChatUpdate(
      asUpdate({
        message: {
          message_id: 1,
          date: 0,
          chat: { id: 1, type: "private", first_name: "owner" },
        } as Update["message"],
      }),
    ),
  ).toBe(false);
});

test("a callback_query (owner pressed Reply) is not business-chat traffic", () => {
  expect(
    isBusinessChatUpdate(
      asUpdate({
        callback_query: { id: "1", data: "oreply_abc" } as Update["callback_query"],
      }),
    ),
  ).toBe(false);
});
