import type { ReactNode } from "react";
import {
  Ban,
  Bot,
  Coins,
  FileText,
  Gift,
  MessageSquare,
  RefreshCcw,
  Sparkles,
  TrendingDown,
  UserPlus,
  Users,
} from "lucide-react";
import type { AdminKpis, AdminTotals } from "@/types";
import { cn } from "@/lib/utils";
import { formatCompact, formatNum } from "./lib";

interface TileProps {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: ReactNode;
  /** Tint the value + icon for emphasis (hero metrics). */
  accent?: boolean;
}

/** One metric tile. Lightweight surface (not a full Bezel) so a dense grid
 * stays calm; tabular numerals keep columns aligned. */
function Tile({ icon, label, value, sub, accent }: TileProps) {
  return (
    <div className="rounded-2xl bg-foreground/[0.03] p-4 ring-1 ring-inset ring-foreground/[0.06]">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span className={cn("[&>svg]:size-3.5", accent && "text-primary")}>
          {icon}
        </span>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.13em]">
          {label}
        </span>
      </div>
      <p
        className={cn(
          "mt-2 font-display text-[1.7rem] font-bold leading-none tabular-nums tracking-[-0.02em]",
          accent && "text-primary",
        )}
      >
        {value}
      </p>
      {sub ? (
        <p className="mt-1.5 text-[12px] leading-tight text-muted-foreground">
          {sub}
        </p>
      ) : null}
    </div>
  );
}

/** All-time snapshot counters — independent of the selected date window. */
export function KpiGrid({ k }: { k: AdminKpis }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Tile
        accent
        icon={<Coins />}
        label="MRR"
        value={formatNum(k.mrrStars)}
        sub="★ / period · active subs"
      />
      <Tile
        icon={<Users />}
        label="Owners"
        value={formatCompact(k.totalOwners)}
        sub={k.bannedOwners > 0 ? `${formatNum(k.bannedOwners)} banned` : "all active"}
      />
      <Tile
        icon={<Sparkles />}
        label="Pro · active"
        value={formatNum(k.activePro)}
      />
      <Tile
        icon={<Sparkles />}
        label="Business · active"
        value={formatNum(k.activeBusiness)}
      />
      <Tile
        icon={<Bot />}
        label="Active bots"
        value={formatNum(k.activeBots)}
      />
      <Tile
        icon={<Gift />}
        label="Comp subs"
        value={formatNum(k.compSubs)}
      />
      <Tile
        icon={<FileText />}
        label="Docs ready"
        value={formatNum(k.readyDocs)}
        sub={`of ${formatNum(k.totalDocs)} total`}
      />
      <Tile
        icon={<Ban />}
        label="Banned"
        value={formatNum(k.bannedOwners)}
      />
    </div>
  );
}

/** Sums over the selected date window. */
export function PeriodTotals({ t }: { t: AdminTotals }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Tile
        accent
        icon={<Coins />}
        label="Revenue"
        value={formatNum(t.revenueStars)}
        sub="★ collected"
      />
      <Tile
        icon={<RefreshCcw />}
        label="Refunded"
        value={formatNum(t.refundStars)}
        sub="★ returned"
      />
      <Tile icon={<UserPlus />} label="New owners" value={formatNum(t.newOwners)} />
      <Tile icon={<Sparkles />} label="New subs" value={formatNum(t.newSubs)} />
      <Tile
        icon={<TrendingDown />}
        label="Cancellations"
        value={formatNum(t.cancellations)}
      />
      <Tile
        icon={<Users />}
        label="Unique customers"
        value={formatCompact(t.uniqueCustomers)}
      />
      <Tile
        icon={<MessageSquare />}
        label="Customer msgs"
        value={formatCompact(t.customerMessages)}
      />
      <Tile
        icon={<MessageSquare />}
        label="AI replies"
        value={formatCompact(t.aiMessages)}
      />
    </div>
  );
}
