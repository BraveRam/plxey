import { lazy, Suspense } from "react";
import { useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
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
      {/* BotFather-style identity hero */}
      <div className="flex flex-col items-center gap-2 pb-5">
        <Avatar name={name} size={80} />
        <h1 className="mt-1 text-xl font-bold tracking-tight">
          {bot.botUsername ? `@${bot.botUsername}` : "Bot"}
        </h1>
        <Badge variant={bot.status === "active" ? "success" : "warning"}>
          {bot.status === "active" ? "Active" : bot.status}
        </Badge>
      </div>

      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="docs">Knowledge</TabsTrigger>
          <TabsTrigger value="analytics">Stats</TabsTrigger>
          <TabsTrigger value="perms">Access</TabsTrigger>
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
