import type { SVGProps } from "react";

/**
 * Single-stroke icon library — handwritten SVGs at strokeWidth 1.6 to
 * stay consistent and avoid the Lucide / FontAwesome look. No emojis
 * are ever used in the design.
 */

type IconProps = SVGProps<SVGSVGElement>;

const base = (extra?: IconProps) => ({
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...extra,
});

export const ArrowRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const ArrowUpRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 17 17 7M9 7h8v8" />
  </svg>
);

export const Spark = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
  </svg>
);

export const Doc = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M14 3v5h5M8 13h8M8 17h6" />
  </svg>
);

export const Bolt = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
  </svg>
);

export const Lock = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

export const Gauge = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 12a9 9 0 1 0-18 0" />
    <path d="m13 13 4-4" />
    <circle cx="12" cy="13" r="1" />
  </svg>
);

export const Chat = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 12a8 8 0 0 1-11.3 7.3L4 21l1.7-5.7A8 8 0 1 1 21 12Z" />
  </svg>
);

export const People = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="9" cy="9" r="3" />
    <path d="M2 20a7 7 0 0 1 14 0" />
    <circle cx="17" cy="8" r="2.5" />
    <path d="M22 19a5 5 0 0 0-6-4.9" />
  </svg>
);

export const Calendar = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

export const Check = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m4 12 5 5L20 7" />
  </svg>
);

export const Plane = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m21 3-9 18-3-8-8-3 20-7Z" />
    <path d="M21 3 11 13" />
  </svg>
);

export const Star = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m12 3 2.6 6 6.4.6-4.9 4.3 1.5 6.3L12 17l-5.6 3.2 1.5-6.3L3 9.6 9.4 9 12 3Z" />
  </svg>
);

export const Chevron = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const Github = (p: IconProps) => (
  <svg {...base({ ...p, fill: "currentColor", stroke: "none" })}>
    <path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 3 .8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.8v2.6c0 .3.2.6.7.5A10 10 0 0 0 12 2Z" />
  </svg>
);

export const Logo = ({ className }: { className?: string }) => (
  <svg
    className={className}
    width={28}
    height={28}
    viewBox="0 0 32 32"
    fill="none"
    aria-hidden
  >
    <rect width="32" height="32" rx="9" fill="currentColor" />
    <path
      d="M9 11h14M9 16h10M9 21h12"
      stroke="var(--accent)"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
  </svg>
);

export const TelegramMark = ({ className }: { className?: string }) => (
  <svg className={className} width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
    <path d="M9.96 15.6 9.8 19c.3 0 .43-.12.59-.27l1.42-1.35 2.94 2.16c.54.3.93.14 1.07-.5l1.95-9.13c.18-.83-.3-1.16-.83-.96L4.7 13.5c-.82.31-.8.77-.14.97l2.97.93 6.9-4.35c.32-.21.62-.1.38.1L9.96 15.6Z" />
  </svg>
);
