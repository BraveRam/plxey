import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface RevealProps {
  children: ReactNode;
  /** Stagger index — children with higher values fade in later. */
  delay?: number;
  className?: string;
  as?: "div" | "section" | "article" | "li";
}

/**
 * Viewport entrance animation. Uses IntersectionObserver (never `scroll`
 * listeners — those tank mobile FPS) to add `.is-in` once the node enters
 * the viewport. CSS handles the actual transition, including the
 * `delay * 60ms` stagger via the `--ds-stagger` custom property.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = "div",
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-in");
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).classList.add("is-in");
            obs.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -10% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={cn("ds-reveal", delay > 0 && "is-staggered", className)}
      style={delay > 0 ? ({ ["--ds-stagger" as never]: delay } as never) : undefined}
    >
      {children}
    </Tag>
  );
}
