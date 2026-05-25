import { useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

interface ScrubTextProps {
  /** Sentence — each word becomes its own span and scrubs from 0.1 → 1 opacity */
  text: string;
  className?: string;
}

/**
 * Scrubbing text reveal — opacity of each word ramps in tied to scroll
 * position (no scroll listeners; pure ScrollTrigger). One of the two
 * RNG-selected GSAP paradigms.
 */
export function ScrubText({ text, className }: ScrubTextProps) {
  const ref = useRef<HTMLParagraphElement | null>(null);

  useGSAP(
    () => {
      const root = ref.current;
      if (!root) return;
      const words = root.querySelectorAll(".scrub-word");
      gsap.fromTo(
        words,
        { opacity: 0.12 },
        {
          opacity: 1,
          stagger: 0.05,
          ease: "none",
          scrollTrigger: {
            trigger: root,
            start: "top 80%",
            end: "bottom 35%",
            scrub: true,
          },
        },
      );
    },
    { scope: ref },
  );

  const words = text.split(" ");
  return (
    <p ref={ref} className={className}>
      {words.map((w, i) => (
        <span key={i} className="scrub-word inline-block">
          {w}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </p>
  );
}
