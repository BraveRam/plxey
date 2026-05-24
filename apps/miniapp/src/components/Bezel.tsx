import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BezelProps extends HTMLAttributes<HTMLDivElement> {
  /** Inner core padding. Default `p-5`. */
  innerClassName?: string;
  /** Optional eyebrow row rendered above the children inside the inner. */
  eyebrow?: ReactNode;
}

/**
 * Double-bezel surface: outer shell wraps an inner core. Mirrors the
 * "Doppelrand" pattern from the high-end visual design skill — premium
 * cards never sit flat on the background.
 */
export function Bezel({
  className,
  innerClassName,
  eyebrow,
  children,
  ...rest
}: BezelProps) {
  return (
    <div className={cn("ds-bezel", className)} {...rest}>
      <div className={cn("ds-bezel-inner relative overflow-hidden", innerClassName ?? "p-5")}>
        {eyebrow ? <div className="mb-3">{eyebrow}</div> : null}
        {children}
      </div>
    </div>
  );
}
