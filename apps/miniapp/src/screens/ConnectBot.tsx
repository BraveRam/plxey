import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

  return (
    <Screen title="Connect a bot" subtitle="Paste the token from @BotFather">
      <Card>
        <CardContent className="space-y-4 pt-4">
          <div className="flex items-start gap-3 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            <KeyRound className="mt-0.5 size-4 shrink-0" />
            <span>
              In Telegram, open @BotFather → <b>/newbot</b> (or
              <b> /token</b> for an existing one) and copy the token it gives
              you.
            </span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="token">Bot token</Label>
            <Input
              id="token"
              inputMode="text"
              autoComplete="off"
              placeholder="123456:ABC-DEF…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Button
        size="lg"
        className="fixed inset-x-4 bottom-5 mx-auto max-w-md"
        disabled={!token.trim() || createBot.isPending}
        onClick={submit}
      >
        {createBot.isPending ? "Connecting…" : "Connect"}
      </Button>
    </Screen>
  );
}
