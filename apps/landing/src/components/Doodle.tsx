import type { SVGProps } from "react";
import { cn } from "@/lib/cn";

/**
 * Hand-drawn ornaments for the Doodle design system. Every doodle is a
 * pure SVG path — no images, no fonts. They're decoration only and
 * carry `aria-hidden` by default.
 */

type Svg = SVGProps<SVGSVGElement> & { className?: string };

const base = ({ className, ...rest }: Svg) => ({
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  className,
  ...rest,
});

/** Imperfect underline scribble — sits under headline words */
export function Squiggle({ className, ...rest }: Svg) {
  return (
    <svg
      viewBox="0 0 240 18"
      preserveAspectRatio="none"
      {...base({ ...rest, className: cn("w-full h-3", className) })}
    >
      <path d="M2 12 C 30 4, 60 16, 92 8 S 150 14, 180 6 S 232 14, 238 9" />
    </svg>
  );
}

/** Marker highlight — block scribble used behind a single word */
export function Highlight({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("absolute inset-x-0 -bottom-1 -z-10 h-[0.55em]", className)}
      style={{
        background: "color-mix(in srgb, var(--c-primary) 55%, transparent)",
        borderRadius: "999px",
        transform: "skewX(-6deg)",
      }}
    />
  );
}

/** Hand-drawn circle — like a marker scribble around something */
export function ScribbleCircle({ className, ...rest }: Svg) {
  return (
    <svg
      viewBox="0 0 100 100"
      {...base({ ...rest, className: cn("w-full h-full", className) })}
    >
      <path d="M50 8 C 22 8, 6 30, 8 52 S 28 92, 58 92 S 96 70, 90 44 S 70 6, 46 10" />
    </svg>
  );
}

/** Curvy hand-drawn arrow pointing right-down */
export function ScribbleArrow({
  direction = "down-right",
  className,
  ...rest
}: Svg & { direction?: "down-right" | "down-left" }) {
  return (
    <svg
      viewBox="0 0 80 70"
      {...base({ ...rest, className: cn("w-16 h-14", className) })}
      style={
        direction === "down-left" ? { transform: "scaleX(-1)" } : undefined
      }
    >
      <path d="M6 6 C 22 18, 10 32, 30 38 S 56 48, 64 60" />
      <path d="M52 56 L 64 62 L 60 50" />
    </svg>
  );
}

/** Asterisk-ish doodle "spark" — used as accent next to labels */
export function Sparkle({ className, ...rest }: Svg) {
  return (
    <svg viewBox="0 0 24 24" {...base({ ...rest, className: cn("w-4 h-4", className) })}>
      <path d="M12 3 L 12 21 M 3 12 L 21 12 M 6 6 L 18 18 M 18 6 L 6 18" />
    </svg>
  );
}

/** Tiny star doodle */
export function StarDoodle({ className, ...rest }: Svg) {
  return (
    <svg viewBox="0 0 24 24" {...base({ ...rest, className: cn("w-4 h-4", className) })}>
      <path d="m12 3 2.4 6 6.1.6-4.6 4 1.3 6.1L12 16.6 6.8 19.7l1.3-6.1L3.5 9.6l6.1-.6L12 3Z" />
    </svg>
  );
}

/** Hand-drawn checkmark */
export function CheckDoodle({ className, ...rest }: Svg) {
  return (
    <svg viewBox="0 0 24 24" {...base({ ...rest, className: cn("w-4 h-4", className) })}>
      <path d="M4 13 C 6 12, 8 14, 10 18 C 13 11, 17 7, 22 5" />
    </svg>
  );
}

/** Arrow right (sketchy) */
export function ArrowRightDoodle({ className, ...rest }: Svg) {
  return (
    <svg viewBox="0 0 24 24" {...base({ ...rest, className: cn("w-4 h-4", className) })}>
      <path d="M3 12 H 21" />
      <path d="M14 5 L 21 12 L 14 19" />
    </svg>
  );
}

/** Arrow up-right (sketchy) */
export function ArrowUpRightDoodle({ className, ...rest }: Svg) {
  return (
    <svg viewBox="0 0 24 24" {...base({ ...rest, className: cn("w-4 h-4", className) })}>
      <path d="M6 18 L 18 6" />
      <path d="M9 6 H 18 V 15" />
    </svg>
  );
}

/** Chat bubble doodle */
export function ChatDoodle({ className, ...rest }: Svg) {
  return (
    <svg viewBox="0 0 24 24" {...base({ ...rest, className: cn("w-5 h-5", className) })}>
      <path d="M4 6 C 4 4, 6 3, 8 3 H 17 C 19 3, 21 4, 21 6 V 13 C 21 15, 19 16, 17 16 H 11 L 6 21 V 16 C 5 16, 4 15, 4 13 Z" />
    </svg>
  );
}

/** Document doodle */
export function DocDoodle({ className, ...rest }: Svg) {
  return (
    <svg viewBox="0 0 24 24" {...base({ ...rest, className: cn("w-5 h-5", className) })}>
      <path d="M7 3 H 14 L 19 8 V 20 C 19 21, 18 21, 17 21 H 7 C 6 21, 5 20, 5 19 V 4 C 5 3, 6 3, 7 3 Z" />
      <path d="M14 3 V 8 H 19" />
      <path d="M8 13 H 16 M 8 17 H 13" />
    </svg>
  );
}

/** Paper plane doodle */
export function PlaneDoodle({ className, ...rest }: Svg) {
  return (
    <svg viewBox="0 0 24 24" {...base({ ...rest, className: cn("w-5 h-5", className) })}>
      <path d="M21 3 L 2 11 L 10 14 L 13 22 L 21 3 Z" />
      <path d="M21 3 L 10 14" />
    </svg>
  );
}

/** Lock doodle */
export function LockDoodle({ className, ...rest }: Svg) {
  return (
    <svg viewBox="0 0 24 24" {...base({ ...rest, className: cn("w-5 h-5", className) })}>
      <path d="M6 11 H 18 V 20 C 18 20, 17 21, 17 21 H 7 C 7 21, 6 20, 6 20 Z" />
      <path d="M8 11 V 7 C 8 5, 10 3, 12 3 S 16 5, 16 7 V 11" />
    </svg>
  );
}

/** Bolt doodle */
export function BoltDoodle({ className, ...rest }: Svg) {
  return (
    <svg viewBox="0 0 24 24" {...base({ ...rest, className: cn("w-5 h-5", className) })}>
      <path d="M13 2 L 4 14 H 11 L 9 22 L 20 10 H 13 Z" />
    </svg>
  );
}

/** Chevron doodle */
export function ChevronDoodle({ className, ...rest }: Svg) {
  return (
    <svg viewBox="0 0 24 24" {...base({ ...rest, className: cn("w-4 h-4", className) })}>
      <path d="M6 9 L 12 15 L 18 9" />
    </svg>
  );
}

/** Heart doodle */
export function HeartDoodle({ className, ...rest }: Svg) {
  return (
    <svg viewBox="0 0 24 24" {...base({ ...rest, className: cn("w-4 h-4", className) })}>
      <path d="M12 21 C 4 14, 2 10, 5 6 S 12 5, 12 9 C 12 5, 19 4, 19 9 S 20 14, 12 21 Z" />
    </svg>
  );
}

/** Plxey mark — hand-drawn headset operator inside a sketched circle.
 *  Echoes the call-center brand without lifting the painted illustration. */
export function DoodleLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      aria-hidden
      className={cn("w-9 h-9", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Hand-drawn outer circle */}
      <path d="M20 3 C 30 3, 37 11, 37 21 S 30 37, 20 37 S 3 30, 3 20 S 10 3, 20 3" />
      {/* Hair tufts */}
      <path d="M11 19 C 11 13, 14 9, 20 9 S 29 13, 29 19" />
      <path d="M11 19 C 10 22, 10 25, 12 27" />
      <path d="M29 19 C 30 22, 30 25, 28 27" />
      {/* Headset arc */}
      <path
        d="M10 19 C 10 12, 14 7, 20 7 S 30 12, 30 19"
        stroke="var(--c-primary)"
        strokeWidth={2.2}
      />
      {/* Headset cups */}
      <circle cx="10" cy="20" r="2" fill="var(--c-primary)" stroke="none" />
      <circle cx="30" cy="20" r="2" fill="var(--c-primary)" stroke="none" />
      {/* Mic boom */}
      <path
        d="M30 21 C 31 24, 28 26, 25 26"
        stroke="var(--c-primary)"
        strokeWidth={2}
      />
      {/* Face — eyes + smile */}
      <circle cx="17" cy="20" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="23" cy="20" r="0.9" fill="currentColor" stroke="none" />
      <path d="M17 24 C 19 26, 21 26, 23 24" />
    </svg>
  );
}
