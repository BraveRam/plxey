import { lazy, Suspense } from "react";
import { useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Settings2, BookOpen, BarChart3, ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Badge } from "@/components/ui/badge";
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
      <div className="px-4 pt-10">
        <Card className="p-6 text-center text-sm text-muted-foreground">
          This bot no longer exists.
        </Card>
      </div>
    );
  }

  if (!bot) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 pt-10">
        <Skeleton className="size-20 rounded-full" />
        <Skeleton className="h-5 w-32" />
      </div>
    );
  }

  const name = bot.botUsername ?? "Bot";

  return (
    <div className="flex min-h-dvh flex-col px-4 pb-24 pt-6">
      {/* BotFather-style identity hero, with a soft glow behind the avatar */}
      <div className="flex flex-col items-center gap-2 pb-5">
        <div className="relative grid place-items-center">
          <div
            aria-hidden
            className="absolute size-24 rounded-full blur-2xl"
            style={{ background: "var(--primary)", opacity: 0.4 }}
          />
          <Avatar name={name} size={84} className="relative ring-2 ring-white/15" />
        </div>
        <h1 className="mt-1 text-xl font-bold tracking-tight">
          {bot.botUsername ? `@${bot.botUsername}` : "Bot"}
        </h1>
        <Badge variant={bot.status === "active" ? "success" : "warning"}>
          {bot.status === "active" ? "Active" : bot.status}
        </Badge>
      </div>

      <Tabs defaultValue="settings">
        <TabsList className="h-auto">
          <TabsTrigger value="settings" className="flex-col gap-1 py-2">
            <Settings2 className="size-[18px]" />
            <span className="text-[11px]">Settings</span>
          </TabsTrigger>
          <TabsTrigger value="docs" className="flex-col gap-1 py-2">
            <BookOpen className="size-[18px]" />
            <span className="text-[11px]">Knowledge</span>
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex-col gap-1 py-2">
            <BarChart3 className="size-[18px]" />
            <span className="text-[11px]">Stats</span>
          </TabsTrigger>
          <TabsTrigger value="perms" className="flex-col gap-1 py-2">
            <ShieldCheck className="size-[18px]" />
            <span className="text-[11px]">Access</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="settings">
          <SettingsPanel bot={bot} />
        </TabsContent>
        <TabsContent value="docs">
          <DocumentsPanel botId={bot.id} />
        </TabsContent>
        <TabsContent value="analytics">
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <AnalyticsPanel botId={bot.id} />
          </Suspense>
        </TabsContent>
        <TabsContent value="perms">
          <PermissionsPanel botId={bot.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
