import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Small muted label above a grouped list. Editorial style. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 pb-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
      {children}
    </p>
  );
}

/**
 * Floating grouped surface. Rows are stitched together with hairline
 * dividers that fade at the inset edges. Wrap in `<Bezel>` for the full
 * double-bezel treatment when needed.
 */
export function ListGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[var(--radius)] border border-border bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface ListRowProps {
  icon?: ReactNode;
  label: ReactNode;
  /** Optional second line under the label. */
  description?: ReactNode;
  trailing?: ReactNode;
  /** Show a trailing arrow + pressable styling. */
  onClick?: () => void;
  chevron?: boolean;
  destructive?: boolean;
}

export function ListRow({
  icon,
  label,
  description,
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
        "group flex items-center gap-3.5 px-5 py-4",
        // Inset hairline between rows, hidden on last child.
        "after:pointer-events-none after:absolute after:inset-x-5 after:bottom-0 after:h-px",
        "after:bg-border last:after:hidden",
        "relative",
        interactive &&
          "ds-press cursor-pointer hover:bg-foreground/[0.03] active:bg-foreground/[0.06]",
      )}
    >
      {icon ? (
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-[10px]",
            "bg-foreground/[0.05]",
            "[&_svg]:size-[18px]",
            destructive ? "text-destructive" : "text-foreground/80",
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-[15.5px] font-medium leading-tight tracking-tight",
            destructive && "text-destructive",
          )}
        >
          {label}
        </p>
        {description ? (
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {trailing ? (
        <span className="shrink-0 text-[13.5px] tabular-nums text-muted-foreground">
          {trailing}
        </span>
      ) : null}
      {chevron ? (
        <span
          aria-hidden
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-full",
            "bg-foreground/[0.05] text-foreground/70",
            "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
            "group-hover:translate-x-0.5 group-hover:-translate-y-[1px] group-hover:scale-105",
          )}
        >
          <ArrowUpRight className="size-[14px]" strokeWidth={2.25} />
        </span>
      ) : null}
    </div>
  );
}
