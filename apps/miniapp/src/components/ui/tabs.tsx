import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

/**
 * Minimal segmented control. The active trigger sits on a flat card pill
 * with a hairline border (no shadow). Used in `BotDetail` to swap panels.
 */
function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex h-auto w-full items-stretch justify-between gap-1 rounded-full",
        "border border-border bg-foreground/[0.04] p-1.5 text-muted-foreground",
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
        "whitespace-nowrap rounded-full border border-transparent px-3 py-2",
        "text-[12px] font-semibold tracking-tight",
        "transition-[color,background-color,border-color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
        "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        "data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:text-foreground",
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
