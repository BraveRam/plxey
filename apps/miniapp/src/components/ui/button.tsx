import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Pill by default. Custom cubic-bezier on transform/opacity only.
  "group relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap " +
    "rounded-full text-[15px] font-semibold tracking-tight " +
    "transition-[transform,background-color,box-shadow,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] " +
    "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 " +
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-foreground text-background shadow-[var(--ds-island-shadow)]",
        primary:
          "bg-primary text-primary-foreground shadow-[var(--ds-island-shadow)]",
        outline:
          "bg-transparent text-foreground border border-border hover:bg-muted/60",
        ghost:
          "bg-transparent text-foreground hover:bg-muted/60",
        destructive:
          "bg-destructive text-destructive-foreground",
        secondary:
          "bg-muted text-foreground border border-border hover:bg-muted/70",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-9 px-4 text-sm",
        default: "h-11 px-5",
        lg: "h-14 px-6 text-[16px]",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />
  );
}

/**
 * "Button-in-button" trailing icon — the icon sits in its own circular
 * tray flush with the right inner padding, never naked next to the text.
 * Place inside `<Button>` as the last child.
 */
function ButtonTrailingIcon({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "ml-1 -mr-1.5 grid size-8 place-items-center rounded-full",
        "bg-white/15 text-inherit",
        "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
        "group-hover:translate-x-0.5 group-hover:-translate-y-[1px] group-hover:scale-105",
        "group-active:scale-95 [&_svg]:size-[16px]",
        className,
      )}
    >
      {children}
    </span>
  );
}

export { Button, ButtonTrailingIcon, buttonVariants };
