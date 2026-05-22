import { Link, useNavigate } from "react-router-dom";
import { Bot, ChevronRight, Plus, CreditCard } from "lucide-react";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useBots } from "@/hooks/api";
import { haptic } from "@/lib/telegram";

function StatusBadge({ status }: { status: string }) {
  if (status === "active") return <Badge variant="success">Active</Badge>;
  if (status === "paused") return <Badge variant="warning">Paused</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

export function BotList() {
  const navigate = useNavigate();
  const { data: bots, isLoading, isError } = useBots();

  return (
    <Screen
      title="Your bots"
      subtitle="Manage prompts, knowledge, and settings"
      action={
        <Button asChild variant="ghost" size="icon" aria-label="Billing">
          <Link to="/billing">
            <CreditCard />
          </Link>
        </Button>
      }
    >
      {isLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card className="p-4 text-sm text-muted-foreground">
          Couldn't load your bots. Pull to retry.
        </Card>
      ) : bots && bots.length > 0 ? (
        <div className="space-y-3">
          {bots.map((bot) => (
            <Card
              key={bot.id}
              onClick={() => {
                haptic.tap();
                navigate(`/bot/${bot.id}`);
              }}
              className="flex cursor-pointer items-center gap-3 p-4 transition-colors hover:bg-accent active:scale-[0.99]"
            >
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Bot className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {bot.botUsername ? `@${bot.botUsername}` : "Bot"}
                </p>
                <div className="mt-1">
                  <StatusBadge status={bot.status} />
                </div>
              </div>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
            </Card>
          ))}
        </div>
      ) : (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Bot className="size-6" />
          </div>
          <div>
            <p className="font-semibold">No bots yet</p>
            <p className="text-sm text-muted-foreground">
              Connect a bot to start answering customers.
            </p>
          </div>
        </Card>
      )}

      <Button asChild size="lg" className="fixed inset-x-4 bottom-5 mx-auto max-w-md">
        <Link to="/connect">
          <Plus /> Connect a bot
        </Link>
      </Button>
    </Screen>
  );
}
