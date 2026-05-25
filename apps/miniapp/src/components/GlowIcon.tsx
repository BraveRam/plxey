import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface GlowIconProps {
  icon: LucideIcon;
  /** Tile size in px. Icon scales to ~52% of it. */
  size?: number;
  /** Accent color (defaults to the Telegram button/primary color). */
  color?: string;
  className?: string;
}

/**
 * A large icon tile used for hero/empty states.
 */
export function GlowIcon({
  icon: Icon,
  size = 88,
  color = "var(--primary)",
  className,
}: GlowIconProps) {
  return (
    <div
      className={cn("relative grid place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <div
        className="relative grid place-items-center rounded-[28%] text-white"
        style={{
          width: size,
          height: size,
          backgroundColor: color,
          boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.18)",
        }}
      >
        <Icon strokeWidth={1.75} style={{ width: size * 0.5, height: size * 0.5 }} />
      </div>
    </div>
  );
}
