import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface Panel {
  id: string;
  label: string;
  body: ReactNode;
  metric?: string;
  bgImage?: string;
}

interface HorizontalAccordionProps {
  panels: Panel[];
  className?: string;
}

/**
 * Vertical slices that expand horizontally on hover/focus to reveal
 * full content. Mobile gracefully degrades into a vertical stack.
 */
export function HorizontalAccordion({
  panels,
  className,
}: HorizontalAccordionProps) {
  const [active, setActive] = useState<string>(panels[0]?.id ?? "");

  return (
    <div
      className={cn(
        "flex flex-col gap-1 md:h-[460px] md:flex-row md:gap-1.5",
        className,
      )}
    >
      {panels.map((p) => {
        const isActive = p.id === active;
        return (
          <button
            key={p.id}
            type="button"
            onMouseEnter={() => setActive(p.id)}
            onFocus={() => setActive(p.id)}
            onClick={() => setActive(p.id)}
            className={cn(
              "press group relative overflow-hidden rounded-[1.75rem] text-left text-bg",
              "ring-1 ring-inset ring-white/10",
              "transition-[flex-basis,padding] duration-700 ease-[var(--ease)]",
              "h-44 md:h-full",
              "shrink-0",
            )}
            style={{
              flex: isActive ? "5 1 0%" : "1 1 0%",
              backgroundColor: "var(--ink)",
            }}
          >
            {p.bgImage ? (
              <div
                aria-hidden
                className="absolute inset-0 transition-transform duration-1000 ease-[var(--ease)] group-hover:scale-105"
                style={{
                  backgroundImage: `url(${p.bgImage})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  filter: "grayscale(0.85) brightness(0.55) contrast(1.1)",
                  opacity: isActive ? 0.55 : 0.35,
                }}
              />
            ) : null}
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(180deg, transparent 30%, rgb(0 0 0 / 0.55) 100%)",
              }}
            />

            {/* Collapsed-state vertical label */}
            <div
              className={cn(
                "pointer-events-none absolute left-5 top-5 z-10 origin-top-left text-[11px] font-semibold uppercase tracking-[0.2em] text-bg/80 transition-opacity duration-300",
                isActive ? "opacity-0 md:opacity-0" : "opacity-100",
              )}
            >
              <span className="md:[writing-mode:vertical-rl]">{p.label}</span>
            </div>

            {/* Expanded content */}
            <div
              className={cn(
                "relative z-10 flex h-full flex-col justify-end p-6 md:p-8",
                "transition-opacity duration-500",
                isActive ? "opacity-100" : "opacity-0 md:opacity-0",
              )}
            >
              <span className="font-mono text-[11.5px] uppercase tracking-[0.2em] text-bg/70">
                {p.label}
              </span>
              {p.metric ? (
                <p className="mt-1 font-display text-[40px] font-bold leading-none tracking-[-0.03em] text-bg md:text-[56px]">
                  {p.metric}
                </p>
              ) : null}
              <div className="mt-3 max-w-[44ch] text-[14.5px] leading-relaxed text-bg/85">
                {p.body}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
