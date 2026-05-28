import { describe, expect, test } from "bun:test";
import { webhookRetryDelayMs } from "../src/lib/api";

// webhookRetryDelayMs decides the backoff before retrying a failed
// setWebhook during a bot restart. Returns null when the failure is
// terminal (don't retry), or a millisecond delay when it's transient.

describe("webhookRetryDelayMs", () => {
  test("429 waits the server-provided retry_after (seconds → ms)", () => {
    expect(
      webhookRetryDelayMs({
        errorCode: 429,
        description: "Too Many Requests: retry after 1",
        retryAfter: 1,
        isNetworkError: false,
        attempt: 1,
      }),
    ).toBe(1000);
  });

  test("429 with no retry_after falls back to 1s", () => {
    expect(
      webhookRetryDelayMs({
        errorCode: 429,
        description: "Too Many Requests",
        retryAfter: null,
        isNetworkError: false,
        attempt: 1,
      }),
    ).toBe(1000);
  });

  test("400 host-resolution flake is transient (backs off by attempt)", () => {
    const args = {
      errorCode: 400,
      description:
        "Bad Request: bad webhook: Failed to resolve host: Temporary failure in name resolution",
      retryAfter: null,
      isNetworkError: false,
    };
    expect(webhookRetryDelayMs({ ...args, attempt: 1 })).toBe(500);
    expect(webhookRetryDelayMs({ ...args, attempt: 2 })).toBe(1000);
  });

  test("network error (no API response) is transient", () => {
    expect(
      webhookRetryDelayMs({
        errorCode: null,
        description: "",
        retryAfter: null,
        isNetworkError: true,
        attempt: 2,
      }),
    ).toBe(1000);
  });

  test("other 400s are terminal (don't retry)", () => {
    expect(
      webhookRetryDelayMs({
        errorCode: 400,
        description: "Bad Request: bad webhook: HTTPS url must be provided",
        retryAfter: null,
        isNetworkError: false,
        attempt: 1,
      }),
    ).toBeNull();
  });

  test("401 unauthorized is terminal", () => {
    expect(
      webhookRetryDelayMs({
        errorCode: 401,
        description: "Unauthorized",
        retryAfter: null,
        isNetworkError: false,
        attempt: 1,
      }),
    ).toBeNull();
  });
});
