import { memo, useEffect, useState } from "react";
import { PlaneDoodle } from "@/components/Doodle";

/**
 * Looping animated chat preview in the doodle style — a handwritten
 * notebook-style chat. Isolated stateful island so the parent layout
 * never re-renders.
 */
type Step =
  | { kind: "customer"; text: string }
  | { kind: "typing" }
  | { kind: "bot"; text: string };

const STORY: Step[] = [
  { kind: "customer", text: "Hey — open Sunday?" },
  { kind: "typing" },
  {
    kind: "bot",
    text: "Yes! 11–18 Sundays, last seating 17:00. Want me to hold a table for two at 13:30?",
  },
  { kind: "customer", text: "Yes please." },
  { kind: "typing" },
  { kind: "bot", text: "Held. I'll confirm by 19:00 today." },
];

export const ChatPreview = memo(function ChatPreview() {
  const [visible, setVisible] = useState<number>(1);

  useEffect(() => {
    const id = window.setInterval(() => {
      setVisible((v) => (v >= STORY.length ? 1 : v + 1));
    }, 2200);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="relative w-full">
      <div className="card-sketch bg-surface !p-4 sm:!p-5">
        <div className="flex items-center justify-between border-b border-text/12 pb-3">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-full bg-text text-paper">
              <PlaneDoodle className="size-4" />
            </div>
            <div className="leading-tight">
              <p className="font-mono text-[13px] font-semibold">
                @caelum_roastery
              </p>
              <p className="flex items-center gap-1.5 font-mono text-[11px] text-text-soft">
                <span
                  aria-hidden
                  className="anim-pulse inline-block size-1.5 rounded-full bg-success"
                />
                online · typing
              </p>
            </div>
          </div>
          <span className="font-mono text-[11px] text-text-muted">11:24</span>
        </div>

        <div className="mt-4 flex max-h-[300px] flex-col gap-2.5 overflow-hidden">
          {STORY.slice(0, visible).map((step, i) => {
            if (step.kind === "typing") {
              return (
                <div key={i} className="self-start">
                  <div className="flex items-center gap-1 rounded-[16px] rounded-bl-md border border-text bg-paper px-3 py-2">
                    <span className="anim-pulse inline-block size-1.5 rounded-full bg-text/50" />
                    <span
                      className="anim-pulse inline-block size-1.5 rounded-full bg-text/50"
                      style={{ animationDelay: "0.15s" }}
                    />
                    <span
                      className="anim-pulse inline-block size-1.5 rounded-full bg-text/50"
                      style={{ animationDelay: "0.3s" }}
                    />
                  </div>
                </div>
              );
            }
            const mine = step.kind === "customer";
            return (
              <div
                key={i}
                className={
                  mine
                    ? "max-w-[78%] self-end rounded-[16px] rounded-br-md border-2 border-text bg-text px-3.5 py-2 text-[13.5px] leading-snug text-paper"
                    : "max-w-[82%] self-start rounded-[16px] rounded-bl-md border-2 border-text bg-paper px-3.5 py-2 text-[13.5px] leading-snug"
                }
              >
                {step.text}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
