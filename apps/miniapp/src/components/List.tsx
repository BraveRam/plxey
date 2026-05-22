import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Small muted label above a grouped list, Telegram-settings style. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 pb-2 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

/** Rounded grouped card; rows inside are separated by inset hairlines. */
export function ListGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl bg-card", className)}>
      {children}
    </div>
  );
}

interface ListRowProps {
  icon?: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
  /** Show a chevron and apply pressable styling. */
  onClick?: () => void;
  chevron?: boolean;
  destructive?: boolean;
}

export function ListRow({
  icon,
  label,
  trailing,
  onClick,
  chevron,
  destructive,
}: ListRowProps) {
  const interactive = !!onClick;
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onClick?.();
            }
          : undefined
      }
      className={cn(
        "flex items-center gap-3 px-4 py-3",
        // Inset divider between rows (skipped on the last via :last-child).
        "border-b border-border/60 last:border-b-0",
        interactive && "cursor-pointer transition-colors active:bg-accent",
      )}
    >
      {icon ? (
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center [&_svg]:size-[22px]",
            destructive ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {icon}
        </span>
      ) : null}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[15px]",
          destructive && "text-destructive",
        )}
      >
        {label}
      </span>
      {trailing ? (
        <span className="shrink-0 text-sm text-muted-foreground">{trailing}</span>
      ) : null}
      {chevron ? (
        <ChevronRight className="size-5 shrink-0 text-muted-foreground/60" />
      ) : null}
    </div>
  );
}
