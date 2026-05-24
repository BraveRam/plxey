import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ScreenProps {
  /** Optional small uppercase pill above the title. */
  eyebrow?: ReactNode;
  title: string;
  subtitle?: string;
  /** Right-aligned action slot (icon button, badge, etc). */
  action?: ReactNode;
  children: ReactNode;
  /** Extra classes on the scrollable wrapper. */
  className?: string;
}

/**
 * Standard padded screen with an editorial header. The page background
 * shell (`ds-bg-shell`) lives on the document body so blurred orbs +
 * grain stay pinned and don't repaint while content scrolls.
 */
export function Screen({
  eyebrow,
  title,
  subtitle,
  action,
  children,
  className,
}: ScreenProps) {
  return (
    <div
      className={cn(
        "ds-bg-shell relative isolate flex min-h-dvh flex-col gap-6 px-5 pb-28 pt-7",
        className,
      )}
    >
      <header className="relative z-10 flex items-start justify-between gap-3">
        <div className="space-y-2.5">
          {eyebrow ? <div className="ds-eyebrow">{eyebrow}</div> : null}
          <h1 className="font-display text-[2rem] font-bold leading-[1.05] tracking-[-0.025em]">
            {title}
          </h1>
          {subtitle ? (
            <p className="max-w-[28ch] text-[15px] leading-snug text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0 pt-1">{action}</div> : null}
      </header>
      <div className="relative z-10 flex flex-1 flex-col gap-5">{children}</div>
    </div>
  );
}
