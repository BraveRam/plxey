import { describe, expect, test } from "bun:test";
import { clientIp, type HeaderLookup } from "../src/lib/client-ip";

function headers(map: Record<string, string>): HeaderLookup {
  return {
    get(name) {
      return map[name.toLowerCase()] ?? null;
    },
  };
}

describe("clientIp", () => {
  test("uses the first hop in X-Forwarded-For", () => {
    expect(
      clientIp(
        headers({ "x-forwarded-for": "203.0.113.42, 10.0.0.1, 10.0.0.2" }),
      ),
    ).toBe("203.0.113.42");
  });

  test("trims whitespace around each hop", () => {
    expect(
      clientIp(headers({ "x-forwarded-for": "   203.0.113.7   " })),
    ).toBe("203.0.113.7");
  });

  test("falls back to X-Real-IP when XFF is absent", () => {
    expect(clientIp(headers({ "x-real-ip": "198.51.100.9" }))).toBe(
      "198.51.100.9",
    );
  });

  test("X-Forwarded-For wins over X-Real-IP when both are present", () => {
    expect(
      clientIp(
        headers({
          "x-forwarded-for": "203.0.113.42",
          "x-real-ip": "198.51.100.9",
        }),
      ),
    ).toBe("203.0.113.42");
  });

  test("returns 'unknown' when no IP header is present", () => {
    expect(clientIp(headers({}))).toBe("unknown");
  });

  test("returns 'unknown' for an empty X-Forwarded-For", () => {
    expect(clientIp(headers({ "x-forwarded-for": "" }))).toBe("unknown");
  });

  test("returns 'unknown' for an XFF whose first hop is empty", () => {
    expect(clientIp(headers({ "x-forwarded-for": "  ," }))).toBe("unknown");
  });
});
