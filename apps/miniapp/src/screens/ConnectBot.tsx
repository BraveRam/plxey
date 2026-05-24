import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { KeyRound, Bot, ArrowRight } from "lucide-react";
import { Screen } from "@/components/Screen";
import { GlowIcon } from "@/components/GlowIcon";
import { Bezel } from "@/components/Bezel";
import { Reveal } from "@/components/Reveal";
import { Button, ButtonTrailingIcon } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateBot } from "@/hooks/api";
import { useBack } from "@/hooks/useBack";
import { haptic } from "@/lib/telegram";

export function ConnectBot() {
  useBack();
  const navigate = useNavigate();
  const createBot = useCreateBot();
  const [token, setToken] = useState("");

  const submit = async () => {
    const trimmed = token.trim();
    if (!trimmed) return;
    try {
      await createBot.mutateAsync(trimmed);
      haptic.success();
      toast.success("Bot connected");
      navigate("/", { replace: true });
    } catch (err) {
      haptic.error();
      toast.error(err instanceof Error ? err.message : "Couldn't connect bot");
    }
  };

  const disabled = !token.trim() || createBot.isPending;

  return (
    <Screen
      eyebrow={<>Connect</>}
      title="Add a new bot"
      subtitle="Paste the token from @BotFather and we'll wire up the rest."
    >
      <Reveal>
        <div className="flex justify-center py-1">
          <GlowIcon icon={Bot} size={104} />
        </div>
      </Reveal>

      <Reveal delay={1}>
        <Bezel innerClassName="p-5">
          <div className="flex items-start gap-3 rounded-2xl bg-foreground/[0.04] p-3.5 text-[13.5px] text-muted-foreground">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-foreground/[0.06] text-foreground/80">
              <KeyRound className="size-[16px]" strokeWidth={2} />
            </span>
            <p className="leading-snug">
              Open <span className="font-semibold text-foreground">@BotFather</span> in
              Telegram →{" "}
              <span className="font-mono text-foreground">/newbot</span> (or{" "}
              <span className="font-mono text-foreground">/token</span> for an
              existing one) and copy the long token it gives you.
            </p>
          </div>

          <div className="mt-5 space-y-2.5">
            <Label
              htmlFor="token"
              className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
              Bot token
            </Label>
            <Input
              id="token"
              inputMode="text"
              autoComplete="off"
              placeholder="123456:ABC-DEF…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="font-mono text-[14.5px]"
            />
            <p className="px-1 text-[12px] text-muted-foreground/80">
              Stored encrypted with AES-GCM. Rotate or revoke any time in
              @BotFather.
            </p>
          </div>
        </Bezel>
      </Reveal>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-md justify-center px-5 pb-5">
        <Button
          size="lg"
          variant="primary"
          disabled={disabled}
          onClick={submit}
          className="pointer-events-auto w-full"
        >
          {createBot.isPending ? (
            "Connecting…"
          ) : (
            <>
              Connect
              <ButtonTrailingIcon>
                <ArrowRight strokeWidth={2.5} />
              </ButtonTrailingIcon>
            </>
          )}
        </Button>
      </div>
    </Screen>
  );
}
