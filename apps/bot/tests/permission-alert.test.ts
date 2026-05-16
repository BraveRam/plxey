import { describe, expect, test } from "bun:test";
import { permissionAlertKey } from "../src/lib/permission-alert";

describe("permissionAlertKey", () => {
  test("is keyed per bot", () => {
    expect(permissionAlertKey("bot-a")).toBe("alert:perm:bot-a");
    expect(permissionAlertKey("bot-b")).toBe("alert:perm:bot-b");
  });

  test("does not include any other identifier — one alert lock per bot", () => {
    expect(permissionAlertKey("uuid-with-dashes-here")).toBe(
      "alert:perm:uuid-with-dashes-here",
    );
  });
});
