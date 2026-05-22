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
 * A large, glowing icon tile — gradient surface + a soft colored halo
 * behind it. Used for hero/empty states to give the app some shine.
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
      {/* Soft radial halo */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-[28%] blur-2xl"
        style={{ background: color, opacity: 0.45 }}
      />
      {/* Gradient tile */}
      <div
        className="relative grid place-items-center rounded-[28%] text-white"
        style={{
          width: size,
          height: size,
          backgroundImage: `linear-gradient(140deg, color-mix(in oklch, ${color} 88%, white) 0%, ${color} 55%, color-mix(in oklch, ${color} 78%, black) 100%)`,
          boxShadow: `0 12px 40px -8px ${color}, inset 0 1px 0 0 rgba(255,255,255,0.25)`,
        }}
      >
        <Icon strokeWidth={1.75} style={{ width: size * 0.5, height: size * 0.5 }} />
      </div>
    </div>
  );
}
