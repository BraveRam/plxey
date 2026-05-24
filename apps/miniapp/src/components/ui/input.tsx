import * as React from "react";
import { cn } from "@/lib/utils";

function Input({
  className,
  type,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-12 w-full rounded-2xl bg-foreground/[0.04] px-4 text-[15px]",
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

export { Input };
