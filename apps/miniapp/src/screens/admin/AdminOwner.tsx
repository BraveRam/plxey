import { useParams } from "react-router-dom";
import { Bot, Gift } from "lucide-react";
import { Screen } from "@/components/Screen";
import { Bezel } from "@/components/Bezel";
import { Reveal } from "@/components/Reveal";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useBack } from "@/hooks/useBack";
import { useAdminOwnerDetail } from "@/hooks/api";
import { ApiError } from "@/lib/api";
import type { AdminOwnerDetail } from "@/types";
import { Forbidden } from "./Forbidden";
import { formatDateFull, formatNum, planLabel, statusVariant } from "./lib";

function ownerName(o: AdminOwnerDetail): string {
  if (o.username) return `@${o.username}`;
  if (o.firstName) return o.firstName;
  return `Owner #${o.telegramUserId}`;
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-inset ring-foreground/[0.06]">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-display text-[18px] font-bold tabular-nums leading-none">
        {value}
      </p>
    </div>
  );
}

export function AdminOwner() {
  useBack();
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, error } = useAdminOwnerDetail(id);

  if (error instanceof ApiError && error.status === 403) {
    return <Forbidden />;
  }

  if (isLoading) {
    return (
      <Screen eyebrow={<>Owner</>} title="Loading…">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </Screen>
    );
  }

  if (isError || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Screen eyebrow={<>Owner</>} title={notFound ? "Not found" : "Error"}>
        <p className="py-8 text-center text-[14px] text-muted-foreground">
          {notFound
            ? "No owner with that id."
            : "Couldn't load this owner. Go back and retry."}
        </p>
      </Screen>
    );
  }

  return (
    <Screen
      eyebrow={<>Owner · #{data.telegramUserId}</>}
      title={ownerName(data)}
      action={
        data.isBanned ? <Badge variant="destructive" dot>banned</Badge> : null
      }
    >
      {/* Profile facts */}
      <Reveal>
        <Bezel innerClassName="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant(data.subscriptionStatus)} dot>
              {data.subscriptionStatus}
            </Badge>
            <Badge variant="secondary">{planLabel(data.currentPlan)}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Fact label="Lifetime ★" value={formatNum(data.lifetimeStarsSpent)} />
            <Fact label="Msgs this period" value={formatNum(data.messagesThisPeriod)} />
            <Fact label="Bots" value={formatNum(data.botCount)} />
            <Fact label="Documents" value={formatNum(data.docCount)} />
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            First seen {formatDateFull(data.firstSeenAt) ?? "—"}
          </p>
        </Bezel>
      </Reveal>

      {/* Subscriptions */}
      <Reveal delay={1}>
        <Bezel innerClassName="space-y-3 p-5">
          <h3 className="font-display text-[16px] font-semibold tracking-tight">
            Subscriptions
          </h3>
          {data.subscriptions.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No subscriptions.</p>
          ) : (
            <ul className="space-y-2.5">
              {data.subscriptions.map((s, i) => (
                <li
                  key={i}
                  className="rounded-xl bg-foreground/[0.03] p-3.5 ring-1 ring-inset ring-foreground/[0.06]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold capitalize">
                        {s.plan}
                      </span>
                      {s.isComplimentary ? (
                        <Badge variant="default" className="px-1.5 py-0 text-[10px]">
                          <Gift className="size-3" /> comp
                        </Badge>
                      ) : null}
                    </div>
                    <Badge variant={statusVariant(s.status)} className="px-2 py-0 text-[10px]">
                      {s.status}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-[12px] text-muted-foreground">
                    {formatNum(s.starsPerPeriod)} ★/period · renews{" "}
                    {formatDateFull(s.currentPeriodEnd) ?? "—"}
                    {s.canceledAt
                      ? ` · canceled ${formatDateFull(s.canceledAt)}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Bezel>
      </Reveal>

      {/* Bots */}
      <Reveal delay={2}>
        <Bezel innerClassName="space-y-3 p-5">
          <h3 className="font-display text-[16px] font-semibold tracking-tight">
            Bots
          </h3>
          {data.bots.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No bots.</p>
          ) : (
            <ul className="space-y-2">
              {data.bots.map((b, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-2 rounded-xl bg-foreground/[0.03] px-3.5 py-2.5 ring-1 ring-inset ring-foreground/[0.06]"
                >
                  <span className="flex items-center gap-2 text-[13.5px] font-medium">
                    <Bot className="size-4 text-muted-foreground" />
                    {b.botUsername ? `@${b.botUsername}` : "—"}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {b.overQuotaAt ? (
                      <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                        over quota
                      </Badge>
                    ) : null}
                    <Badge variant={statusVariant(b.status)} className="px-2 py-0 text-[10px]">
                      {b.status}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Bezel>
      </Reveal>
    </Screen>
  );
}
