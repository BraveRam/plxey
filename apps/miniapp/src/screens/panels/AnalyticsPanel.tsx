import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics } from "@/hooks/api";
import type { StatsBucket } from "@/types";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/60 p-3 text-center">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Window({ title, bucket }: { title: string; bucket: StatsBucket }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-2">
        <Stat label="Received" value={bucket.received} />
        <Stat label="Answered" value={bucket.answered} />
        <Stat label="Customers" value={bucket.customers} />
      </CardContent>
    </Card>
  );
}

export function AnalyticsPanel({ botId }: { botId: string }) {
  const { data, isLoading } = useAnalytics(botId);

  if (isLoading || !data) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <div className="space-y-4">
      <Window title="Today" bucket={data.today} />
      <Window title="Last 7 days" bucket={data.last7d} />
      <Window title="Last 30 days" bucket={data.last30d} />
      {data.lastMessageAt ? (
        <p className="px-1 text-center text-xs text-muted-foreground">
          Last customer message{" "}
          {new Date(data.lastMessageAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}
