import { cn } from "@/lib/utils";

/**
 * Telegram-style identity avatar with a deterministic color per seed.
 * Color picks stay stable so each bot keeps the same identity across the app.
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
}

export function Avatar({ name, size = 44, className }: AvatarProps) {
  const color = pick(name);
  const fontSize = size * 0.36;
  return (
    <div
      className={cn("relative grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <div
        aria-hidden
        className="relative grid place-items-center rounded-full font-display font-bold text-white"
        style={{
          width: size,
          height: size,
          fontSize,
          letterSpacing: "-0.01em",
          backgroundColor: color,
          boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.25)",
        }}
      >
        {initials(name)}
      </div>
    </div>
  );
}
