import { describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import { verifyInitData } from "../src/lib/telegram-auth";

const BOT_TOKEN = "123456:test-bot-token";

// Mirror Telegram's signing so we can produce valid fixtures: build the
// data-check-string (sorted, hash excluded), sign with the WebAppData
// secret key, and append the hash.
function signInitData(
  fields: Record<string, string>,
  botToken: string = BOT_TOKEN,
): string {
  const pairs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const dataCheckString = pairs.join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const params = new URLSearchParams(fields);
  params.set("hash", hash);
  return params.toString();
}

function freshFields(userId = 42): Record<string, string> {
  return {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAErandom",
    user: JSON.stringify({ id: userId, first_name: "Test", username: "tester" }),
  };
}

describe("verifyInitData", () => {
  test("accepts a correctly signed payload and returns the user", () => {
    const initData = signInitData(freshFields(777));
    const result = verifyInitData(initData, BOT_TOKEN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe(777);
      expect(result.user.username).toBe("tester");
    }
  });

  test("rejects a tampered hash", () => {
    const initData = signInitData(freshFields());
    const tampered = initData.replace(/hash=[0-9a-f]+/, "hash=deadbeef");
    const result = verifyInitData(tampered, BOT_TOKEN);
    expect(result.ok).toBe(false);
  });

  test("rejects when a field is mutated after signing", () => {
    const initData = signInitData(freshFields(1));
    // Swap the user id without re-signing.
    const forged = initData.replace(
      encodeURIComponent(JSON.stringify({ id: 1, first_name: "Test", username: "tester" })),
      encodeURIComponent(JSON.stringify({ id: 999, first_name: "Test", username: "tester" })),
    );
    const result = verifyInitData(forged, BOT_TOKEN);
    expect(result.ok).toBe(false);
  });

  test("rejects a stale auth_date", () => {
    const stale = {
      auth_date: String(Math.floor(Date.now() / 1000) - 48 * 60 * 60),
      user: JSON.stringify({ id: 5, first_name: "Old" }),
    };
    const initData = signInitData(stale);
    const result = verifyInitData(initData, BOT_TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("stale auth_date");
  });

  test("rejects the wrong bot token", () => {
    const initData = signInitData(freshFields());
    const result = verifyInitData(initData, "999999:different-token");
    expect(result.ok).toBe(false);
  });

  test("rejects empty initData", () => {
    expect(verifyInitData("", BOT_TOKEN).ok).toBe(false);
  });

  test("rejects payload missing a hash", () => {
    const params = new URLSearchParams(freshFields());
    expect(verifyInitData(params.toString(), BOT_TOKEN).ok).toBe(false);
  });
});
