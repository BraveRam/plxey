import { useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

interface ScrollScaleProps {
  children: ReactNode;
  className?: string;
}

/**
 * Image-scale-and-fade scroll paradigm. Element starts at scale 0.85,
 * grows to 1.0 in view, then fades to opacity 0.25 as it scrolls past.
 * Pure transform + opacity — GPU friendly, no layout thrash.
 */
export function ScrollScale({ children, className }: ScrollScaleProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      // Phase 1: scale + reveal as it enters
      gsap.fromTo(
        el,
        { scale: 0.85, opacity: 0.5, filter: "blur(6px)" },
        {
          scale: 1,
          opacity: 1,
          filter: "blur(0px)",
          ease: "power3.out",
          scrollTrigger: {
            trigger: el,
            start: "top 90%",
            end: "top 35%",
            scrub: true,
          },
        },
      );
      // Phase 2: fade + darken as it exits
      gsap.to(el, {
        opacity: 0.25,
        scale: 0.96,
        ease: "power2.in",
        scrollTrigger: {
          trigger: el,
          start: "bottom 70%",
          end: "bottom 10%",
          scrub: true,
        },
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={className} style={{ willChange: "transform, opacity" }}>
      {children}
    </div>
  );
}
