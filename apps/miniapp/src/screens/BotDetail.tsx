import { lazy, Suspense } from "react";
import { useParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Settings2, BookOpen, BarChart3, ShieldCheck, ArrowUpRight } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Bezel } from "@/components/Bezel";
import { Reveal } from "@/components/Reveal";
import { Badge } from "@/components/ui/badge";
import { haptic, openTelegramLink } from "@/lib/telegram";
import { useBack } from "@/hooks/useBack";
import { useBot, useBots } from "@/hooks/api";
import { SettingsPanel } from "@/screens/panels/SettingsPanel";
import { DocumentsPanel } from "@/screens/panels/DocumentsPanel";
import { PermissionsPanel } from "@/screens/panels/PermissionsPanel";

// Lazy — pulls recharts into its own chunk, loaded only when the Stats
// tab is opened, keeping the initial bundle light.
const AnalyticsPanel = lazy(() =>
  import("@/screens/panels/AnalyticsPanel").then((m) => ({
    default: m.AnalyticsPanel,
  })),
);

export function BotDetail() {
  useBack();
  const { id } = useParams<{ id: string }>();
  const { isLoading } = useBots();
  const bot = useBot(id);

  if (!isLoading && !bot) {
    return (
      <div className="ds-bg-shell relative isolate min-h-dvh px-5 pt-12">
        <Bezel innerClassName="p-6 text-center">
          <p className="text-[14px] text-muted-foreground">
            This bot no longer exists.
          </p>
        </Bezel>
      </div>
    );
  }

  if (!bot) {
    return (
      <div className="ds-bg-shell relative isolate flex min-h-dvh flex-col items-center gap-3 px-5 pt-12">
        <Skeleton className="size-24 rounded-full" />
        <Skeleton className="h-6 w-40 rounded-full" />
        <Skeleton className="h-10 w-full rounded-full" />
      </div>
    );
  }

  const name = bot.botUsername ?? "Bot";

  return (
    <div className="ds-bg-shell relative isolate flex min-h-dvh flex-col gap-6 px-5 pb-24 pt-7">
      {/* Identity hero */}
      <Reveal>
        <header className="relative z-10 flex flex-col items-center gap-3 text-center">
          <Avatar name={name} size={92} />
          <div className="space-y-1.5">
            <h1 className="font-display text-[26px] font-bold tracking-[-0.02em]">
              {bot.botUsername ? (
                <button
                  type="button"
                  aria-label={`Open @${bot.botUsername} on Telegram`}
                  onClick={() => {
                    haptic.tap();
                    openTelegramLink(`https://t.me/${bot.botUsername}`);
                  }}
                  className="group inline-flex items-center gap-1 transition-colors hover:text-primary active:opacity-80"
                >
                  @{bot.botUsername}
                  <ArrowUpRight
                    className="size-[18px] translate-y-px text-muted-foreground transition-colors group-hover:text-primary"
                    strokeWidth={2.5}
                  />
                </button>
              ) : (
                "Bot"
              )}
            </h1>
            <div className="flex justify-center">
              <Badge
                variant={bot.status === "active" ? "success" : "warning"}
                dot
              >
                {bot.status === "active" ? "Live" : bot.status}
              </Badge>
            </div>
          </div>
        </header>
      </Reveal>

      <Reveal delay={1}>
        <Tabs defaultValue="settings" className="relative z-10">
          <TabsList>
            <TabsTrigger value="settings" className="flex-col gap-1 py-2">
              <Settings2 className="size-[16px]" strokeWidth={2} />
              <span className="text-[10.5px] uppercase tracking-wider">
                Settings
              </span>
            </TabsTrigger>
            <TabsTrigger value="docs" className="flex-col gap-1 py-2">
              <BookOpen className="size-[16px]" strokeWidth={2} />
              <span className="text-[10.5px] uppercase tracking-wider">
                Knowledge
              </span>
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex-col gap-1 py-2">
              <BarChart3 className="size-[16px]" strokeWidth={2} />
              <span className="text-[10.5px] uppercase tracking-wider">
                Stats
              </span>
            </TabsTrigger>
            <TabsTrigger value="perms" className="flex-col gap-1 py-2">
              <ShieldCheck className="size-[16px]" strokeWidth={2} />
              <span className="text-[10.5px] uppercase tracking-wider">
                Access
              </span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="settings">
            <SettingsPanel bot={bot} />
          </TabsContent>
          <TabsContent value="docs">
            <DocumentsPanel botId={bot.id} />
          </TabsContent>
          <TabsContent value="analytics">
            <Suspense fallback={<Skeleton className="h-64 w-full rounded-2xl" />}>
              <AnalyticsPanel botId={bot.id} />
            </Suspense>
          </TabsContent>
          <TabsContent value="perms">
            <PermissionsPanel botId={bot.id} />
          </TabsContent>
        </Tabs>
      </Reveal>
    </div>
  );
}
