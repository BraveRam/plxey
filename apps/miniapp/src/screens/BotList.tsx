import { Link, useNavigate } from "react-router-dom";
import { Plus, Sparkles, CreditCard, Bot } from "lucide-react";
import { Screen } from "@/components/Screen";
import { GlowIcon } from "@/components/GlowIcon";
import { Bezel } from "@/components/Bezel";
import { Reveal } from "@/components/Reveal";
import { Avatar } from "@/components/Avatar";
import { Button, ButtonTrailingIcon } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ListGroup, ListRow, SectionLabel } from "@/components/List";
import { useBots } from "@/hooks/api";
import { haptic } from "@/lib/telegram";

function StatusBadge({ status }: { status: string }) {
  if (status === "active")
    return (
      <Badge variant="success" dot>
        Live
      </Badge>
    );
  if (status === "paused")
    return (
      <Badge variant="warning" dot>
        Paused
      </Badge>
    );
  return <Badge variant="secondary">{status}</Badge>;
}

export function BotList() {
  const navigate = useNavigate();
  const { data: bots, isLoading, isError } = useBots();

  return (
    <Screen
      eyebrow={<>Control panel</>}
      title="Your bots"
      subtitle="Prompts, knowledge, and access — all in one place."
      action={
        <Button
          asChild
          variant="secondary"
          size="icon"
          aria-label="Billing"
          className="rounded-full"
        >
          <Link to="/billing" onClick={() => haptic.tap()}>
            <CreditCard />
          </Link>
        </Button>
      }
    >
      {isLoading ? (
        <Bezel innerClassName="p-0">
          <div className="space-y-2 p-4">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
          </div>
        </Bezel>
      ) : isError ? (
        <Bezel>
          <p className="text-sm text-muted-foreground">
            Couldn't load your bots. Pull to retry.
          </p>
        </Bezel>
      ) : bots && bots.length > 0 ? (
        <Reveal>
          <SectionLabel>
            {bots.length} {bots.length === 1 ? "bot" : "bots"}
          </SectionLabel>
          <ListGroup>
            {bots.map((bot, i) => {
              const name = bot.botUsername ?? "Bot";
              return (
                <Reveal key={bot.id} delay={i + 1}>
                  <ListRow
                    icon={<Avatar name={name} size={40} />}
                    label={bot.botUsername ? `@${bot.botUsername}` : "Bot"}
                    description={
                      bot.status === "active" ? "Active" : "Paused"
                    }
                    trailing={<StatusBadge status={bot.status} />}
                    chevron
                    onClick={() => {
                      haptic.tap();
                      navigate(`/bot/${bot.id}`);
                    }}
                  />
                </Reveal>
              );
            })}
          </ListGroup>
        </Reveal>
      ) : (
        <Reveal>
          <Bezel innerClassName="px-6 py-10">
            <div className="flex flex-col items-center gap-5 text-center">
              <GlowIcon icon={Bot} size={88} />
              <div className="space-y-2">
                <h2 className="font-display text-[22px] font-semibold tracking-tight">
                  No bots yet
                </h2>
                <p className="max-w-[26ch] text-[14px] leading-snug text-muted-foreground">
                  Connect a bot to start answering customers automatically —
                  on autopilot, around the clock.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-[12px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="size-3.5" /> AI replies
                </span>
                <span aria-hidden className="opacity-30">
                  ·
                </span>
                <span>Document knowledge</span>
                <span aria-hidden className="opacity-30">
                  ·
                </span>
                <span>Stats included</span>
              </div>
            </div>
          </Bezel>
        </Reveal>
      )}

      {/* Floating CTA island — sits above the safe-area inset */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-md justify-center px-5 pb-5">
        <Button
          asChild
          size="lg"
          variant="primary"
          className="pointer-events-auto w-full"
        >
          <Link to="/connect" onClick={() => haptic.tap()}>
            <Plus className="size-[18px]" />
            Connect a bot
            <ButtonTrailingIcon>
              <span className="font-bold">↗</span>
            </ButtonTrailingIcon>
          </Link>
        </Button>
      </div>
    </Screen>
  );
}
