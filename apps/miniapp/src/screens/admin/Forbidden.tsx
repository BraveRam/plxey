import { ShieldX } from "lucide-react";
import { Screen } from "@/components/Screen";
import { Bezel } from "@/components/Bezel";

/**
 * Shown when the admin API returns 403 — i.e. the launching Telegram user is
 * not ADMIN_TELEGRAM_USER_ID. Deliberately terse: it reveals nothing about
 * the surface beyond "not for you". Any owner who taps a leaked deep link
 * lands here, never on data.
 */
export function Forbidden() {
  return (
    <Screen eyebrow={<>Restricted</>} title="Admin only">
      <Bezel innerClassName="flex flex-col items-center gap-3 p-8 text-center">
        <div className="rounded-full border border-destructive/25 bg-destructive/10 p-3 text-destructive">
          <ShieldX className="size-6" />
        </div>
        <p className="max-w-[34ch] text-[14px] leading-snug text-muted-foreground">
          This dashboard is limited to the platform operator. Your account
          isn&apos;t authorized to view it.
        </p>
      </Bezel>
    </Screen>
  );
}
