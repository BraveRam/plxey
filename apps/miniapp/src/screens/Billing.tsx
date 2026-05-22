import { CreditCard } from "lucide-react";
import { Screen } from "@/components/Screen";
import { GlowIcon } from "@/components/GlowIcon";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBilling } from "@/hooks/api";
import { useBack } from "@/hooks/useBack";
import { haptic, openTelegramLink } from "@/lib/telegram";
import type { BillingSummary } from "@/types";

function planLabel(plan: BillingSummary["plan"]): string {
  if (plan === "pro") return "Pro";
  if (plan === "business") return "Business";
  if (plan === "trial") return "Trial";
  return "No plan";
}

function statusVariant(status: BillingSummary["status"]) {
  if (status === "active") return "success" as const;
  if (status === "trialing") return "default" as const;
  if (status === "canceled") return "warning" as const;
  return "destructive" as const;
}

function UsageRow({ label, used, cap }: { label: string; used: number; cap: number | null }) {
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {used}
          {cap !== null ? ` / ${cap}` : ""}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function Billing() {
  useBack();
  const { data, isLoading } = useBilling();

  return (
    <Screen title="Billing" subtitle="Your plan and usage">
      {isLoading || !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div className="flex justify-center py-2">
            <GlowIcon icon={CreditCard} size={84} />
          </div>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-xl">{planLabel(data.plan)}</CardTitle>
              <Badge variant={statusVariant(data.status)}>{data.status}</Badge>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              {data.status === "trialing" && fmtDate(data.trialEndsAt) ? (
                <p>Trial ends {fmtDate(data.trialEndsAt)}</p>
              ) : null}
              {data.subscriptionRenewsAt ? (
                <p>Renews {fmtDate(data.subscriptionRenewsAt)}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Usage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <UsageRow label="Bots" used={data.usage.bots} cap={data.caps?.maxBots ?? null} />
              <UsageRow
                label="Documents"
                used={data.usage.docs}
                cap={
                  data.caps
                    ? data.caps.maxDocsPerBot * Math.max(data.usage.bots, 1)
                    : null
                }
              />
              <UsageRow
                label="Messages this period"
                used={data.usage.messages}
                cap={data.caps?.maxMessagesPerPeriod ?? null}
              />
            </CardContent>
          </Card>

          {data.botUsername ? (
            <Button
              size="lg"
              className="w-full"
              onClick={() => {
                haptic.tap();
                openTelegramLink(
                  `https://t.me/${data.botUsername}?start=billing`,
                );
              }}
            >
              <CreditCard /> Manage subscription
            </Button>
          ) : (
            <p className="px-1 text-center text-xs text-muted-foreground">
              Manage your subscription with /billing in the bot chat.
            </p>
          )}
        </>
      )}
    </Screen>
  );
}
