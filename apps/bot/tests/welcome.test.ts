import { describe, expect, test } from "bun:test";
import { InlineKeyboard } from "grammy";
import {
  DEFAULT_WELCOME_MESSAGE,
  renderCustomerWelcome,
} from "../src/bots/welcome";

describe("renderCustomerWelcome", () => {
  test("uses the custom welcome message when provided", () => {
    const { text } = renderCustomerWelcome({
      welcomeMessage: "Hi! Ask us anything.",
      connectedBusinessUserId: "12345",
    });
    expect(text).toBe("Hi! Ask us anything.");
  });

  test("falls back to default when welcome message is null", () => {
    const { text } = renderCustomerWelcome({
      welcomeMessage: null,
      connectedBusinessUserId: "12345",
    });
    expect(text).toBe(DEFAULT_WELCOME_MESSAGE);
  });

  test("falls back to default when welcome message is whitespace only", () => {
    const { text } = renderCustomerWelcome({
      welcomeMessage: "   \n\t  ",
      connectedBusinessUserId: "12345",
    });
    expect(text).toBe(DEFAULT_WELCOME_MESSAGE);
  });

  test("trims surrounding whitespace from custom messages", () => {
    const { text } = renderCustomerWelcome({
      welcomeMessage: "  Hello!  ",
      connectedBusinessUserId: null,
    });
    expect(text).toBe("Hello!");
  });

  test("includes contact-business button when business is connected", () => {
    const { keyboard } = renderCustomerWelcome({
      welcomeMessage: "anything",
      connectedBusinessUserId: "98765",
    });
    expect(keyboard).toBeInstanceOf(InlineKeyboard);
    const rows = (keyboard as InlineKeyboard).inline_keyboard;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(1);
    expect(rows[0]?.[0]).toMatchObject({
      text: "💬 Contact Business",
      url: "tg://user?id=98765",
    });
  });

  test("omits the keyboard when no business is connected", () => {
    const { keyboard } = renderCustomerWelcome({
      welcomeMessage: "anything",
      connectedBusinessUserId: null,
    });
    expect(keyboard).toBeNull();
  });

  test("DEFAULT_WELCOME_MESSAGE is a non-empty string", () => {
    expect(typeof DEFAULT_WELCOME_MESSAGE).toBe("string");
    expect(DEFAULT_WELCOME_MESSAGE.length).toBeGreaterThan(0);
  });
});
