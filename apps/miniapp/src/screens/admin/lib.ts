// Shared helpers for the admin dashboard: date-range presets, number /
// currency / date formatting, and status → badge-variant mapping. Pure
// functions only — no React, no I/O — so they're trivially testable.

export type PresetKey = "7d" | "30d" | "90d" | "1y" | "all" | "custom";

export interface RangeState {
  preset: PresetKey;
  /** Custom-mode bounds (YYYY-MM-DD). Ignored unless preset === "custom". */
  from?: string;
  to?: string;
}

export const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "1y", label: "1y" },
  { key: "all", label: "All" },
];

const DAY_MS = 24 * 60 * 60 * 1000;
// Floor for the "All" preset — safely before this project had any data, so
// the series spans every real day without an unbounded generate_series.
const ALL_TIME_FLOOR = "2024-01-01";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve a range selection into the `{ from, to }` query the API expects
 * (YYYY-MM-DD). Presets are computed relative to `now`; custom passes its
 * bounds through (the server tolerates missing/inverted/invalid bounds).
 */
export function resolveRange(
  state: RangeState,
  now: Date = new Date(),
): { from?: string; to?: string } {
  const to = ymd(now);
  switch (state.preset) {
    case "7d":
      return { from: ymd(new Date(now.getTime() - 7 * DAY_MS)), to };
    case "30d":
      return { from: ymd(new Date(now.getTime() - 30 * DAY_MS)), to };
    case "90d":
      return { from: ymd(new Date(now.getTime() - 90 * DAY_MS)), to };
    case "1y":
      return { from: ymd(new Date(now.getTime() - 365 * DAY_MS)), to };
    case "all":
      return { from: ALL_TIME_FLOOR, to };
    case "custom":
      return { from: state.from || undefined, to: state.to || undefined };
  }
}

export function formatNum(n: number): string {
  return n.toLocaleString();
}

/** Compact form for big hero numbers (1.2k, 3.4M). */
export function formatCompact(n: number): string {
  if (Math.abs(n) >= 1000) {
    return new Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  }
  return String(n);
}

export function formatStars(n: number): string {
  return `${formatNum(n)} ★`;
}

/** "May 14" — short axis/label form. */
export function formatDayShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "May 14, 2026" — full date for detail rows. */
export function formatDateFull(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export type BadgeVariant =
  | "default"
  | "secondary"
  | "success"
  | "warning"
  | "destructive"
  | "outline";

export function statusVariant(status: string): BadgeVariant {
  switch (status) {
    case "active":
      return "success";
    case "trialing":
      return "default";
    case "canceled":
      return "warning";
    case "lapsed":
    case "revoked":
      return "destructive";
    case "paused":
      return "secondary";
    default:
      return "outline";
  }
}

export function planLabel(plan: string | null): string {
  if (plan === "pro") return "Pro";
  if (plan === "business") return "Business";
  if (plan === "trial") return "Trial";
  return "—";
}
