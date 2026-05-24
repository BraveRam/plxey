import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex min-h-28 w-full resize-y rounded-2xl bg-foreground/[0.04] px-4 py-3 text-[15px] leading-snug",
        "ring-1 ring-inset ring-foreground/[0.06]",
        "shadow-[inset_0_1px_0_0_var(--ds-inner-highlight)]",
        "transition-[box-shadow,background-color] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
        "placeholder:text-muted-foreground/70",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:bg-foreground/[0.06]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
