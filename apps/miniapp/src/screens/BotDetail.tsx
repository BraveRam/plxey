import { lazy, Suspense } from "react";
import { useParams } from "react-router-dom";
import { Screen } from "@/components/Screen";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
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
      <Screen title="Bot not found">
        <Card className="p-6 text-center text-sm text-muted-foreground">
          This bot no longer exists.
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      title={bot?.botUsername ? `@${bot.botUsername}` : "Bot"}
      subtitle="Settings, knowledge, analytics"
    >
      {bot ? (
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
      ) : null}
    </Screen>
  );
}
