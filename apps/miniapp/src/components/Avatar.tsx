import { cn } from "@/lib/utils";

/**
 * Telegram-style identity avatar with a deterministic color per seed.
 * The premium variant adds a gradient surface, an inner highlight, and
 * (optionally) a soft halo behind the disk. Color picks stay stable so
 * each bot keeps the same identity across the app.
 */
const PALETTE = [
  "oklch(0.72 0.15 165)", // teal (BotFather-like)
  "oklch(0.68 0.16 250)", // blue
  "oklch(0.70 0.17 300)", // violet
  "oklch(0.72 0.16 40)", // orange
  "oklch(0.70 0.15 350)", // pink
  "oklch(0.70 0.15 145)", // green
];

function pick(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}

function initials(name: string): string {
  const cleaned = name.replace(/^@/, "").trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

interface AvatarProps {
  name: string;
  size?: number;
  className?: string;
  /** Render a soft, slow-pulsing colored halo behind the disk. */
  halo?: boolean;
}

export function Avatar({ name, size = 44, className, halo }: AvatarProps) {
  const color = pick(name);
  const fontSize = size * 0.36;
  return (
    <div
      className={cn("relative grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      {halo ? (
        <div
          aria-hidden
          className="ds-orb absolute inset-[-30%] rounded-full blur-2xl"
          style={{ background: color, opacity: 0.42 }}
        />
      ) : null}
      <div
        aria-hidden
        className="relative grid place-items-center rounded-full font-display font-bold text-white"
        style={{
          width: size,
          height: size,
          fontSize,
          letterSpacing: "-0.01em",
          backgroundImage: `radial-gradient(120% 120% at 20% 0%, color-mix(in oklch, ${color} 70%, white) 0%, ${color} 55%, color-mix(in oklch, ${color} 75%, black) 100%)`,
          boxShadow: `inset 0 1px 0 0 rgba(255,255,255,0.35), 0 6px 18px -8px ${color}`,
        }}
      >
        {initials(name)}
      </div>
    </div>
  );
}
