import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface MarqueeProps {
  items: ReactNode[];
  className?: string;
  /** Direction the row scrolls. */
  reverse?: boolean;
  /** Gap between items in tailwind class form. */
  gap?: string;
}

/**
 * Infinite kinetic marquee — duplicates content twice and scrolls via
 * pure CSS so there's no JS per-frame cost. Edges fade out via gradient
 * masks.
 */
export function Marquee({
  items,
  className,
  reverse,
  gap = "gap-10",
}: MarqueeProps) {
  return (
    <div className={cn("no-scrollbar relative overflow-hidden", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24"
        style={{
          background:
            "linear-gradient(to right, var(--bg), color-mix(in oklch, var(--bg) 0%, transparent))",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24"
        style={{
          background:
            "linear-gradient(to left, var(--bg), color-mix(in oklch, var(--bg) 0%, transparent))",
        }}
      />
      <div
        className={cn(
          "anim-ticker flex w-max items-center whitespace-nowrap",
          gap,
        )}
        style={reverse ? { animationDirection: "reverse" } : undefined}
      >
        {[...items, ...items].map((it, i) => (
          <div key={i} className="inline-flex items-center">{it}</div>
        ))}
      </div>
    </div>
  );
}
