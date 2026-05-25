import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Stagger index — translates to `--idx * 70ms` delay via CSS. */
  delay?: number;
  as?: "div" | "section" | "article" | "li" | "span";
}

/**
 * IntersectionObserver-driven entrance animation. Never uses
 * `window.scroll` listeners (catastrophic on mobile). CSS in
 * `index.css` owns the actual transition curve.
 */
export function Reveal({ children, className, delay = 0, as: Tag = "div" }: RevealProps) {
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
      { threshold: 0.05, rootMargin: "0px 0px -8% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={cn("reveal", className)}
      {...(delay > 0
        ? { "data-stagger": "", style: { ["--idx" as never]: delay } as never }
        : {})}
    >
      {children}
    </Tag>
  );
}
