import type { ReactNode } from "react";

interface ScreenProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}

/** Standard padded screen with an editorial header. */
export function Screen({ title, subtitle, action, children }: ScreenProps) {
  return (
    <div className="flex min-h-dvh flex-col gap-5 px-4 pb-24 pt-5">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle ? (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}
