/**
 * Pure helpers shared across the sweep / reminder cron functions.
 *
 * Kept SQL-agnostic and side-effect-free so they can be unit-tested without a
 * DB harness. The cron functions in this directory take care of the actual
 * Drizzle queries and Inngest event emission.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Returns the 24-hour notification window that "T-`days`d before" maps to,
 * when scanned daily.
 *
 * For a daily scan running at time `now`, a value `t` is considered "T-Nd"
 * iff `start < t <= end`, where:
 *   - `end   = now + N days`
 *   - `start = now + (N-1) days`
 *
 * This is a strict half-open window (start exclusive, end inclusive) so that
 * a value that lands exactly on a previous tick's boundary is not picked up
 * twice across consecutive daily runs. The handler-side Redis dedup
 * (`notify:{kind}:{ownerId}:{periodOrDate}`) is the canonical idempotency
 * boundary; this window is just the first filter.
 */
export function thresholdWindow(
  now: Date,
  days: number,
): { start: Date; end: Date } {
  const nowMs = now.getTime();
  return {
    start: new Date(nowMs + (days - 1) * MS_PER_DAY),
    end: new Date(nowMs + days * MS_PER_DAY),
  };
}

/**
 * Returns true iff `t` falls within the T-`days`d threshold window relative
 * to `now`. Uses the same half-open `(start, end]` semantics as
 * {@link thresholdWindow}.
 */
export function isWithinThresholdWindow(
  t: Date | null | undefined,
  now: Date,
  days: number,
): boolean {
  if (t === null || t === undefined) return false;
  const { start, end } = thresholdWindow(now, days);
  const ms = t.getTime();
  return ms > start.getTime() && ms <= end.getTime();
}
