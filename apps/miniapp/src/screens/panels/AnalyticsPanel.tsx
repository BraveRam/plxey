import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics } from "@/hooks/api";
import type { BotAnalytics, StatsBucket } from "@/types";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-foreground/[0.04] p-3 text-center">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function chartData(data: BotAnalytics) {
  const rows: Array<{ window: string } & StatsBucket> = [
    { window: "Today", ...data.today },
    { window: "7 days", ...data.last7d },
    { window: "30 days", ...data.last30d },
  ];
  return rows;
}

export function AnalyticsPanel({ botId }: { botId: string }) {
  const { data, isLoading } = useAnalytics(botId);

  if (isLoading || !data) {
    return <Skeleton className="h-64 w-full" />;
  }

  const rows = chartData(data);
  const hasActivity = rows.some((r) => r.received > 0 || r.answered > 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Messages</CardTitle>
        </CardHeader>
        <CardContent>
          {hasActivity ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={rows} barGap={4} margin={{ left: -20, top: 4 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="window"
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  stroke="var(--muted-foreground)"
                  width={32}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--card-foreground)",
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="received"
                  name="Received"
                  fill="var(--muted-foreground)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="answered"
                  name="Answered"
                  fill="var(--primary)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No customer activity yet.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Today</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-2">
          <Stat label="Received" value={data.today.received} />
          <Stat label="Answered" value={data.today.answered} />
          <Stat label="Customers" value={data.today.customers} />
        </CardContent>
      </Card>

      {data.lastMessageAt ? (
        <p className="px-1 text-center text-xs text-muted-foreground">
          Last customer message {new Date(data.lastMessageAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}
