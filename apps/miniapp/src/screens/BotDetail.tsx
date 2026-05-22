import { useParams } from "react-router-dom";
import { Screen } from "@/components/Screen";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useBack } from "@/hooks/useBack";
import { useBot, useBots } from "@/hooks/api";
import { SettingsPanel } from "@/screens/panels/SettingsPanel";
import { DocumentsPanel } from "@/screens/panels/DocumentsPanel";
import { AnalyticsPanel } from "@/screens/panels/AnalyticsPanel";
import { PermissionsPanel } from "@/screens/panels/PermissionsPanel";

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
            <AnalyticsPanel botId={bot.id} />
          </TabsContent>
          <TabsContent value="perms">
            <PermissionsPanel botId={bot.id} />
          </TabsContent>
        </Tabs>
      ) : null}
    </Screen>
  );
}
