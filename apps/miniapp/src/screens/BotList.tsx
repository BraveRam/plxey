import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Plus, CreditCard, Bot } from "lucide-react";
import { Screen } from "@/components/Screen";
import { GlowIcon } from "@/components/GlowIcon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar } from "@/components/Avatar";
import { ListGroup, SectionLabel } from "@/components/List";
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
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : isError ? (
        <Card className="p-4 text-sm text-muted-foreground">
          Couldn't load your bots. Pull to retry.
        </Card>
      ) : bots && bots.length > 0 ? (
        <div>
          <SectionLabel>Bots</SectionLabel>
          <ListGroup>
            {bots.map((bot) => {
              const name = bot.botUsername ?? "Bot";
              return (
                <div
                  key={bot.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    haptic.tap();
                    navigate(`/bot/${bot.id}`);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ")
                      navigate(`/bot/${bot.id}`);
                  }}
                  className="flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2.5 transition-colors last:border-b-0 active:bg-accent"
                >
                  <Avatar name={name} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {bot.botUsername ? `@${bot.botUsername}` : "Bot"}
                    </p>
                    <div className="mt-0.5">
                      <StatusBadge status={bot.status} />
                    </div>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground/60" />
                </div>
              );
            })}
          </ListGroup>
        </div>
      ) : (
        <Card className="flex flex-col items-center gap-4 p-10 text-center">
          <GlowIcon icon={Bot} size={96} />
          <div>
            <p className="text-lg font-semibold">No bots yet</p>
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
