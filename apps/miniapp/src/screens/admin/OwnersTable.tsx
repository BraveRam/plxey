import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Bezel } from "@/components/Bezel";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminOwners } from "@/hooks/api";
import { haptic } from "@/lib/telegram";
import type { AdminOwnerRow } from "@/types";
import { formatNum, planLabel, statusVariant } from "./lib";

/** Debounce a fast-changing value so search doesn't fire per keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function ownerName(o: AdminOwnerRow): string {
  if (o.username) return `@${o.username}`;
  if (o.firstName) return o.firstName;
  return `#${o.telegramUserId}`;
}

function Row({ o }: { o: AdminOwnerRow }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => {
        haptic.tap();
        navigate(`/admin/owner/${o.telegramUserId}`);
      }}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.04]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[14px] font-semibold tracking-tight">
            {ownerName(o)}
          </span>
          {o.isBanned ? (
            <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
              banned
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">
          {o.botCount} bots · {o.docCount} docs · {formatNum(o.lifetimeStarsSpent)} ★
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge variant={statusVariant(o.subscriptionStatus)} className="px-2 py-0 text-[10px]">
          {planLabel(o.currentPlan)}
        </Badge>
      </div>
    </button>
  );
}

export function OwnersTable() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search.trim(), 300);

  // New search term → back to page 1.
  useEffect(() => {
    setPage(1);
  }, [debounced]);

  const { data, isLoading, isError, isPlaceholderData } = useAdminOwners(
    debounced,
    page,
  );

  return (
    <Bezel innerClassName="p-5">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h3 className="font-display text-[16px] font-semibold tracking-tight">
          Owners
        </h3>
        <span className="text-[11.5px] text-muted-foreground">
          tap a row for detail
        </span>
      </div>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by @username or numeric id"
          className="pl-10"
          inputMode="search"
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <p className="py-8 text-center text-[13px] text-destructive">
          Couldn&apos;t load owners.
        </p>
      ) : !data || data.rows.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-muted-foreground">
          {debounced ? "No owners match that search." : "No owners yet."}
        </p>
      ) : (
        <div
          className={
            isPlaceholderData ? "-mx-2 opacity-60 transition-opacity" : "-mx-2"
          }
        >
          {data.rows.map((o) => (
            <Row key={o.telegramUserId} o={o} />
          ))}
        </div>
      )}

      {data && (page > 1 || data.hasMore) ? (
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            disabled={page <= 1 || isPlaceholderData}
            onClick={() => {
              haptic.tap();
              setPage((p) => Math.max(1, p - 1));
            }}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-muted-foreground ring-1 ring-inset ring-foreground/[0.08] transition-colors hover:text-foreground disabled:opacity-40"
          >
            <ChevronLeft className="size-4" /> Prev
          </button>
          <span className="text-[12px] tabular-nums text-muted-foreground">
            Page {page}
          </span>
          <button
            type="button"
            disabled={!data.hasMore || isPlaceholderData}
            onClick={() => {
              haptic.tap();
              setPage((p) => p + 1);
            }}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-muted-foreground ring-1 ring-inset ring-foreground/[0.08] transition-colors hover:text-foreground disabled:opacity-40"
          >
            Next <ChevronRight className="size-4" />
          </button>
        </div>
      ) : null}
    </Bezel>
  );
}
