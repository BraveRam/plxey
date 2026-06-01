import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-tight " +
    "transition-colors",
  {
    variants: {
      variant: {
        default:
          "bg-primary/12 text-primary border-primary/20",
        secondary:
          "bg-foreground/[0.06] text-foreground border-foreground/[0.1]",
        success:
          "bg-emerald-500/12 text-emerald-600 border-emerald-500/25 dark:text-emerald-300",
        warning:
          "bg-amber-500/12 text-amber-600 border-amber-500/25 dark:text-amber-300",
        destructive:
          "bg-destructive/12 text-destructive border-destructive/25",
        outline:
          "bg-transparent text-foreground border-foreground/[0.14]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** Optional pulse dot prefix; matches the variant's accent. */
  dot?: boolean;
}

function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? (
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full bg-current",
            "shadow-[0_0_0_3px_color-mix(in_oklch,currentColor_30%,transparent)]",
          )}
        />
      ) : null}
      {children}
    </div>
  );
}

export { Badge, badgeVariants };
