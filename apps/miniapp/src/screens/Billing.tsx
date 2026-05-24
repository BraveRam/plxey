import { ArrowUpRight, Sparkles } from "lucide-react";
import { Screen } from "@/components/Screen";
import { Bezel } from "@/components/Bezel";
import { Reveal } from "@/components/Reveal";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonTrailingIcon } from "@/components/ui/button";
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

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatNum(n: number): string {
  if (n >= 1000) return n.toLocaleString();
  return String(n);
}

/**
 * Usage bar with a soft glowing fill, segment label, and tabular numerals
 * for the count line. The fill animates on mount via the global Reveal
 * helper — no per-row scroll listener.
 */
function UsageBar({
  label,
  used,
  cap,
}: {
  label: string;
  used: number;
  cap: number | null;
}) {
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const warn = pct >= 80;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        <span className="font-display text-[14px] font-semibold tabular-nums tracking-tight">
          <span className={warn ? "text-amber-500" : "text-foreground"}>
            {formatNum(used)}
          </span>
          {cap !== null ? (
            <span className="text-muted-foreground"> / {formatNum(cap)}</span>
          ) : null}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-foreground/[0.06] ring-1 ring-inset ring-foreground/[0.06]">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]"
          style={{
            width: `${pct}%`,
            boxShadow: warn
              ? "0 0 12px 2px color-mix(in oklch, var(--destructive) 30%, transparent)"
              : "0 0 12px 0 color-mix(in oklch, var(--primary) 35%, transparent)",
            background: warn
              ? "linear-gradient(90deg, var(--primary), var(--destructive))"
              : undefined,
          }}
        />
      </div>
    </div>
  );
}

export function Billing() {
  useBack();
  const { data, isLoading } = useBilling();

  return (
    <Screen
      eyebrow={<>Subscription</>}
      title="Billing"
      subtitle="Your plan, usage, and renewal."
    >
      {isLoading || !data ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : (
        <>
          {/* Plan hero — gradient halo + status pill */}
          <Reveal>
            <Bezel innerClassName="relative p-6 overflow-hidden">
              <div
                aria-hidden
                className="ds-orb pointer-events-none absolute -right-10 -top-12 size-44 rounded-full blur-3xl"
                style={{ background: "var(--primary)", opacity: 0.35 }}
              />
              <div className="relative flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <Sparkles className="size-3.5" />
                  Current plan
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-[34px] font-bold leading-none tracking-[-0.025em]">
                    {planLabel(data.plan)}
                  </h2>
                  <Badge variant={statusVariant(data.status)} dot>
                    {data.status}
                  </Badge>
                </div>
                <div className="mt-3 space-y-0.5 text-[13.5px] text-muted-foreground">
                  {data.status === "trialing" && fmtDate(data.trialEndsAt) ? (
                    <p>
                      Trial ends{" "}
                      <span className="font-medium text-foreground">
                        {fmtDate(data.trialEndsAt)}
                      </span>
                    </p>
                  ) : null}
                  {data.subscriptionRenewsAt ? (
                    <p>
                      Renews{" "}
                      <span className="font-medium text-foreground">
                        {fmtDate(data.subscriptionRenewsAt)}
                      </span>
                    </p>
                  ) : null}
                </div>
              </div>
            </Bezel>
          </Reveal>

          {/* Usage block */}
          <Reveal delay={1}>
            <Bezel innerClassName="p-6">
              <div className="mb-5 flex items-center justify-between">
                <h3 className="font-display text-[17px] font-semibold tracking-tight">
                  Usage
                </h3>
                <span className="text-[12px] text-muted-foreground">
                  Resets at renewal
                </span>
              </div>
              <div className="space-y-5">
                <UsageBar
                  label="Bots"
                  used={data.usage.bots}
                  cap={data.caps?.maxBots ?? null}
                />
                <UsageBar
                  label="Documents"
                  used={data.usage.docs}
                  cap={
                    data.caps
                      ? data.caps.maxDocsPerBot * Math.max(data.usage.bots, 1)
                      : null
                  }
                />
                <UsageBar
                  label="Messages this period"
                  used={data.usage.messages}
                  cap={data.caps?.maxMessagesPerPeriod ?? null}
                />
              </div>
            </Bezel>
          </Reveal>

          {/* Manage CTA island */}
          <Reveal delay={2}>
            {data.botUsername ? (
              <Button
                size="lg"
                variant="primary"
                className="w-full"
                onClick={() => {
                  haptic.tap();
                  openTelegramLink(
                    `https://t.me/${data.botUsername}?start=billing`,
                  );
                }}
              >
                Manage subscription
                <ButtonTrailingIcon>
                  <ArrowUpRight strokeWidth={2.5} />
                </ButtonTrailingIcon>
              </Button>
            ) : (
              <p className="px-1 text-center text-[13px] text-muted-foreground">
                Manage your subscription with{" "}
                <span className="font-mono text-foreground">/billing</span> in
                the bot chat.
              </p>
            )}
          </Reveal>
        </>
      )}
    </Screen>
  );
}
