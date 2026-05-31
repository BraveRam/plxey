import { useState } from "react";
import { Screen } from "@/components/Screen";
import { Reveal } from "@/components/Reveal";
import { Skeleton } from "@/components/ui/skeleton";
import { useBack } from "@/hooks/useBack";
import { useAdminMetrics } from "@/hooks/api";
import { ApiError } from "@/lib/api";
import { DateRangeBar } from "./DateRangeBar";
import { Forbidden } from "./Forbidden";
import { KpiGrid, PeriodTotals } from "./Kpis";
import { Breakdowns, GrowthChart, MessagesChart, RevenueHero } from "./Charts";
import { OwnersTable } from "./OwnersTable";
import { resolveRange, type RangeState } from "./lib";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </h2>
  );
}

export function AdminDashboard() {
  useBack();
  const [range, setRange] = useState<RangeState>({ preset: "30d" });
  const resolved = resolveRange(range);
  const { data, isLoading, isError, error } = useAdminMetrics(resolved);

  // A 403 means the launching Telegram user isn't the admin — show the
  // forbidden wall instead of the dashboard chrome.
  if (error instanceof ApiError && error.status === 403) {
    return <Forbidden />;
  }

  return (
    <Screen
      eyebrow={<>Operations</>}
      title="Dashboard"
      subtitle="Revenue, growth, and tenants across the platform."
    >
      <Reveal>
        <DateRangeBar value={range} onChange={setRange} />
      </Reveal>

      {isLoading || !data ? (
        isError ? (
          <p className="py-10 text-center text-[14px] text-destructive">
            Couldn&apos;t load metrics. Pull to retry.
          </p>
        ) : (
          <div className="space-y-3">
            <Skeleton className="h-44 w-full rounded-2xl" />
            <div className="grid grid-cols-2 gap-2.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-2xl" />
              ))}
            </div>
            <Skeleton className="h-56 w-full rounded-2xl" />
          </div>
        )
      ) : (
        <>
          <Reveal delay={1}>
            <RevenueHero
              data={data.series.revenue}
              totalStars={data.totals.revenueStars}
            />
          </Reveal>

          <Reveal delay={2} className="space-y-3">
            <SectionLabel>At a glance · all-time</SectionLabel>
            <KpiGrid k={data.kpis} />
          </Reveal>

          <Reveal delay={3} className="space-y-3">
            <SectionLabel>This window</SectionLabel>
            <PeriodTotals t={data.totals} />
          </Reveal>

          <Reveal delay={4}>
            <GrowthChart series={data.series} />
          </Reveal>

          <Reveal delay={5}>
            <MessagesChart series={data.series.messages} />
          </Reveal>

          <Reveal delay={6}>
            <Breakdowns b={data.breakdowns} />
          </Reveal>

          <Reveal delay={7}>
            <OwnersTable />
          </Reveal>
        </>
      )}
    </Screen>
  );
}
