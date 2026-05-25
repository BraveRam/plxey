import { memo, useEffect, useState } from "react";
import { TelegramMark } from "@/components/Icon";

/**
 * Looping animated chat preview — a Telegram conversation where a
 * customer messages the bot directly (no Business account required)
 * and the AI answers from uploaded docs. Wrapped in memo + isolated
 * stateful island so heavy re-renders never reach parent layout.
 */
type Step =
  | { kind: "customer"; text: string }
  | { kind: "typing" }
  | { kind: "bot"; text: string };

const STORY: Step[] = [
  { kind: "customer", text: "Hi — what are your hours on Sunday?" },
  { kind: "typing" },
  {
    kind: "bot",
    text:
      "We're open 11–18 on Sundays, last seating at 17:00. Want me to hold a table for two at 13:30?",
  },
  { kind: "customer", text: "Yes please." },
  { kind: "typing" },
  {
    kind: "bot",
    text: "Held. I'll confirm by 19:00 today. Anything else?",
  },
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
    <div className="relative">
      <div
        aria-hidden
        className="anim-orb absolute -inset-12 -z-10 rounded-[3.5rem] blur-3xl"
        style={{ background: "var(--accent)", opacity: 0.18 }}
      />

      <div className="glass relative overflow-hidden rounded-[2.5rem] p-4 sm:p-5">
        <div className="flex items-center justify-between rounded-[1.75rem] bg-ink/[0.04] px-4 py-3">
          <div className="flex items-center gap-3">
            <div
              aria-hidden
              className="grid size-9 place-items-center rounded-full text-white"
              style={{
                background:
                  "linear-gradient(140deg, color-mix(in oklch, var(--accent) 80%, white) 0%, var(--accent) 60%, var(--accent-deep) 100%)",
              }}
            >
              <TelegramMark />
            </div>
            <div>
              <p className="text-[13px] font-semibold tracking-tight">
                @caelum_roastery_bot
              </p>
              <p className="flex items-center gap-1.5 text-[11px] text-ink-soft">
                <span
                  aria-hidden
                  className="anim-pulse inline-block size-1.5 rounded-full"
                  style={{ background: "var(--accent)" }}
                />
                online · replying
              </p>
            </div>
          </div>
          <span className="font-mono text-[11px] text-ink-muted">11:24</span>
        </div>

        <div className="mt-4 flex max-h-[360px] flex-col gap-2.5 overflow-hidden px-1 pb-1">
          {STORY.slice(0, visible).map((step, i) => {
            if (step.kind === "typing") {
              return (
                <div key={i} className="self-start">
                  <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-ink/[0.05] px-3 py-2">
                    <span className="anim-pulse inline-block size-1.5 rounded-full bg-ink-muted" />
                    <span
                      className="anim-pulse inline-block size-1.5 rounded-full bg-ink-muted"
                      style={{ animationDelay: "0.15s" }}
                    />
                    <span
                      className="anim-pulse inline-block size-1.5 rounded-full bg-ink-muted"
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
                    ? "max-w-[78%] self-end rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-[13.5px] leading-snug text-bg"
                    : "max-w-[82%] self-start rounded-2xl rounded-bl-md bg-ink/[0.05] px-3.5 py-2 text-[13.5px] leading-snug"
                }
              >
                {step.text}
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="anim-float absolute -left-4 bottom-10 hidden rounded-2xl border border-ink/10 bg-surface px-3 py-2 text-[11.5px] font-medium shadow-[var(--shadow-island)] sm:flex"
        style={{ animationDelay: "1.2s" }}
      >
        <span className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-accent-soft text-[var(--accent-deep)]">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
          </svg>
        </span>
        Pulled answer from{" "}
        <code className="ml-1 rounded-md bg-ink/5 px-1.5 py-0.5 font-mono text-[10.5px]">
          sunday-hours.txt
        </code>
      </div>
    </div>
  );
});
