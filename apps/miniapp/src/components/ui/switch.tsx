import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full",
        "transition-[background-color,box-shadow] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
        "ring-1 ring-inset ring-foreground/[0.08]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-primary data-[state=checked]:shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_25%,transparent)]",
        "data-[state=unchecked]:bg-foreground/[0.1]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-6 translate-x-0.5 rounded-full bg-white",
          "shadow-[0_2px_4px_rgb(0_0_0/0.18),0_0_0_1px_rgb(0_0_0/0.04)]",
          "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
          "data-[state=checked]:translate-x-[22px]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
