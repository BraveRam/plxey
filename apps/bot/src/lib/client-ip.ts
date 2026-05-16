// Minimal headers shape so callers can pass either Hono's c.req or a plain
// fetch-style Headers object.
export interface HeaderLookup {
  get(name: string): string | null | undefined;
}

/**
 * Best-effort client IP extraction from forwarded headers. Returns
 * "unknown" when nothing usable is present — callers should treat that as
 * its own bucket for rate-limit purposes rather than failing open.
 *
 * X-Forwarded-For is the standard chain (left-most = original client);
 * X-Real-IP is the fallback some proxies set instead.
 */
export function clientIp(headers: HeaderLookup): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip");
  if (real) {
    const trimmed = real.trim();
    if (trimmed) return trimmed;
  }
  return "unknown";
}
