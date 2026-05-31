import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Bezel } from "@/components/Bezel";
import type { AdminSeries, AdminBreakdowns } from "@/types";
import { formatDayShort, formatNum, formatStars } from "./lib";

// Series colors. Hardcoded emerald/destructive so they read in both themes;
// primary/muted-foreground follow the Telegram-synced palette.
const C_PRIMARY = "var(--primary)";
const C_MUTED = "var(--muted-foreground)";
const C_EMERALD = "#10b981";
const C_RED = "var(--destructive)";

const axisProps = {
  tickLine: false,
  axisLine: false,
  fontSize: 11,
  stroke: "var(--muted-foreground)",
} as const;

const tooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--card-foreground)",
  fontSize: 12,
} as const;

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Bezel innerClassName="p-5">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h3 className="font-display text-[16px] font-semibold tracking-tight">
          {title}
        </h3>
        {hint ? (
          <span className="text-[11.5px] text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      {children}
    </Bezel>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <p className="py-10 text-center text-[13px] text-muted-foreground">{label}</p>
  );
}

/** Auto-thinned x-axis tick formatter — recharts thins via minTickGap. */
const xAxis = (
  <XAxis dataKey="date" {...axisProps} tickFormatter={formatDayShort} minTickGap={28} />
);

/** Hero revenue area chart over the window, with the window total as the
 * headline number. */
export function RevenueHero({
  data,
  totalStars,
}: {
  data: AdminSeries["revenue"];
  totalStars: number;
}) {
  const hasRevenue = data.some((d) => d.stars > 0);
  return (
    <Bezel innerClassName="relative overflow-hidden p-6">
      <div className="relative flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Revenue · selected window
        </span>
        <h2 className="font-display text-[34px] font-bold leading-none tracking-[-0.025em]">
          {formatStars(totalStars)}
        </h2>
      </div>
      <div className="mt-4">
        {hasRevenue ? (
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart data={data} margin={{ left: -22, right: 4, top: 4 }}>
              <defs>
                <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C_PRIMARY} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={C_PRIMARY} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              {xAxis}
              <YAxis {...axisProps} width={34} allowDecimals={false} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(l) => formatDayShort(String(l))}
                formatter={(v: number) => [formatStars(v), "Revenue"]}
              />
              <Area
                type="monotone"
                dataKey="stars"
                stroke={C_PRIMARY}
                strokeWidth={2}
                fill="url(#revFill)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart label="No revenue in this window." />
        )}
      </div>
    </Bezel>
  );
}

/** Merge the three count series (identical day axis) into one row set. */
function mergeGrowth(series: AdminSeries) {
  return series.signups.map((row, i) => ({
    date: row.date,
    signups: row.count,
    newSubs: series.newSubs[i]?.count ?? 0,
    cancellations: series.cancellations[i]?.count ?? 0,
  }));
}

export function GrowthChart({ series }: { series: AdminSeries }) {
  const data = mergeGrowth(series);
  const hasData = data.some(
    (d) => d.signups > 0 || d.newSubs > 0 || d.cancellations > 0,
  );
  return (
    <ChartCard title="Growth" hint="signups · subs · churn">
      {hasData ? (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ left: -24, right: 4, top: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            {xAxis}
            <YAxis {...axisProps} width={30} allowDecimals={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(l) => formatDayShort(String(l))}
            />
            <Line type="monotone" dataKey="signups" name="Signups" stroke={C_PRIMARY} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="newSubs" name="New subs" stroke={C_EMERALD} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="cancellations" name="Churn" stroke={C_RED} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <EmptyChart label="No signups, subscriptions, or churn in this window." />
      )}
      <Legend2
        items={[
          { name: "Signups", color: C_PRIMARY },
          { name: "New subs", color: C_EMERALD },
          { name: "Churn", color: C_RED },
        ]}
      />
    </ChartCard>
  );
}

export function MessagesChart({ series }: { series: AdminSeries["messages"] }) {
  const hasData = series.some((d) => d.received > 0 || d.answered > 0);
  return (
    <ChartCard title="Messages" hint="received · answered">
      {hasData ? (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={series} margin={{ left: -24, right: 4, top: 4 }}>
            <defs>
              <linearGradient id="ansFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C_PRIMARY} stopOpacity={0.3} />
                <stop offset="100%" stopColor={C_PRIMARY} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            {xAxis}
            <YAxis {...axisProps} width={30} allowDecimals={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(l) => formatDayShort(String(l))}
            />
            <Area type="monotone" dataKey="received" name="Received" stroke={C_MUTED} strokeWidth={1.5} fillOpacity={0} dot={false} />
            <Area type="monotone" dataKey="answered" name="Answered" stroke={C_PRIMARY} strokeWidth={2} fill="url(#ansFill)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <EmptyChart label="No customer messages in this window." />
      )}
      <Legend2
        items={[
          { name: "Received", color: C_MUTED },
          { name: "Answered", color: C_PRIMARY },
        ]}
      />
    </ChartCard>
  );
}

/** Tiny inline legend (recharts <Legend> is hard to theme + position). */
function Legend2({ items }: { items: Array<{ name: string; color: string }> }) {
  return (
    <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
      {items.map((it) => (
        <span key={it.name} className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: it.color }} />
          {it.name}
        </span>
      ))}
    </div>
  );
}

// --- Breakdowns (horizontal bar lists) --------------------------------------

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 truncate text-[12.5px] capitalize text-muted-foreground">
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-foreground/[0.05]">
        <div
          className="h-full rounded-full bg-primary/70"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right font-display text-[13px] font-semibold tabular-nums">
        {formatNum(value)}
      </span>
    </div>
  );
}

function BreakdownBlock({
  title,
  map,
}: {
  title: string;
  map: Record<string, number>;
}) {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const max = entries.reduce((m, [, v]) => Math.max(m, v), 0);
  return (
    <div>
      <h4 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h4>
      {entries.length > 0 ? (
        <div className="space-y-2">
          {entries.map(([k, v]) => (
            <BarRow key={k} label={k} value={v} max={max} />
          ))}
        </div>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">None.</p>
      )}
    </div>
  );
}

export function Breakdowns({ b }: { b: AdminBreakdowns }) {
  return (
    <Bezel innerClassName="space-y-5 p-5">
      <h3 className="font-display text-[16px] font-semibold tracking-tight">
        Breakdowns
      </h3>
      <BreakdownBlock title="Subscriptions by status" map={b.subsByStatus} />
      <BreakdownBlock title="Active plans" map={b.subsByPlanActive} />
      <BreakdownBlock title="Bots by status" map={b.botsByStatus} />
      <BreakdownBlock title="Documents by status" map={b.docsByStatus} />
    </Bezel>
  );
}
