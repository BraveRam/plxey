import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

/**
 * Glass-pill tab strip. The active trigger lifts onto a floating pill
 * inside the strip — closer to iOS segmented control than the default
 * shadcn bar. Used vertically in `BotDetail` to swap between panels.
 */
function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex h-auto w-full items-stretch justify-between gap-1 rounded-full",
        "bg-foreground/[0.05] p-1.5 text-muted-foreground",
        "ring-1 ring-inset ring-foreground/[0.06] shadow-[inset_0_1px_0_0_var(--ds-inner-highlight)]",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex flex-1 select-none items-center justify-center gap-1.5",
        "whitespace-nowrap rounded-full px-3 py-2",
        "text-[12px] font-semibold tracking-tight",
        "transition-[color,background-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
        "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        "data-[state=active]:bg-card data-[state=active]:text-foreground",
        "data-[state=active]:shadow-[0_1px_2px_rgb(0_0_0/0.06),0_8px_20px_-10px_rgb(0_0_0/0.18)]",
        "data-[state=active]:ring-1 data-[state=active]:ring-foreground/[0.06]",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("mt-5 focus-visible:outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
