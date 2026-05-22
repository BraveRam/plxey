import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { useUpdateBot, useDeleteBot } from "@/hooks/api";
import { haptic } from "@/lib/telegram";
import type { PublicBot } from "@/types";

export function SettingsPanel({ bot }: { bot: PublicBot }) {
  const navigate = useNavigate();
  const update = useUpdateBot();
  const remove = useDeleteBot();

  const [systemPrompt, setSystemPrompt] = useState(bot.systemPrompt);
  const [welcome, setWelcome] = useState(bot.welcomeMessage ?? "");
  const [capStr, setCapStr] = useState(
    bot.dailyUserAiReplyLimit !== null ? String(bot.dailyUserAiReplyLimit) : "",
  );
  const [capMessage, setCapMessage] = useState(bot.dailyCapReachedMessage ?? "");

  const dirty =
    systemPrompt !== bot.systemPrompt ||
    welcome !== (bot.welcomeMessage ?? "") ||
    capStr !== (bot.dailyUserAiReplyLimit !== null ? String(bot.dailyUserAiReplyLimit) : "") ||
    capMessage !== (bot.dailyCapReachedMessage ?? "");

  const save = async () => {
    const cap = capStr.trim() === "" ? null : Number(capStr);
    if (cap !== null && (!Number.isInteger(cap) || cap < 0)) {
      toast.error("Daily limit must be a positive whole number");
      return;
    }
    try {
      await update.mutateAsync({
        id: bot.id,
        patch: {
          systemPrompt,
          welcomeMessage: welcome.trim() === "" ? null : welcome,
          dailyUserAiReplyLimit: cap,
          dailyCapReachedMessage: capMessage.trim() === "" ? null : capMessage,
        },
      });
      haptic.success();
      toast.success("Saved");
    } catch (err) {
      haptic.error();
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  const toggle = async (
    field: "autoReadBusinessMessages",
    value: boolean,
  ) => {
    try {
      await update.mutateAsync({ id: bot.id, patch: { [field]: value } });
      haptic.tap();
    } catch {
      haptic.error();
      toast.error("Couldn't update");
    }
  };

  const togglePause = async () => {
    const next = bot.status === "active" ? "paused" : "active";
    try {
      await update.mutateAsync({ id: bot.id, patch: { status: next } });
      haptic.tap();
      toast.success(next === "active" ? "Bot resumed" : "Bot paused");
    } catch {
      haptic.error();
      toast.error("Couldn't update");
    }
  };

  const doDelete = async () => {
    try {
      await remove.mutateAsync(bot.id);
      haptic.success();
      toast.success("Bot deleted");
      navigate("/", { replace: true });
    } catch (err) {
      haptic.error();
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">System prompt</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="min-h-32"
            placeholder="You are a helpful support assistant for…"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Welcome message</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={welcome}
            onChange={(e) => setWelcome(e.target.value)}
            placeholder="Leave blank for the default greeting"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center justify-between pt-4">
          <div className="pr-4">
            <p className="font-medium">Auto-read messages</p>
            <p className="text-sm text-muted-foreground">
              Mark customer chats as read automatically.
            </p>
          </div>
          <Switch
            checked={bot.autoReadBusinessMessages}
            onCheckedChange={(v) => toggle("autoReadBusinessMessages", v)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily reply limit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="cap">Per customer, per day</Label>
            <Input
              id="cap"
              inputMode="numeric"
              placeholder="Unlimited"
              value={capStr}
              onChange={(e) => setCapStr(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="capmsg">Message when limit reached</Label>
            <Textarea
              id="capmsg"
              value={capMessage}
              onChange={(e) => setCapMessage(e.target.value)}
              placeholder="Leave blank for the default"
            />
          </div>
        </CardContent>
      </Card>

      <Button className="w-full" size="lg" disabled={!dirty || update.isPending} onClick={save}>
        {update.isPending ? "Saving…" : "Save changes"}
      </Button>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={togglePause}>
          {bot.status === "active" ? "Pause bot" : "Resume bot"}
        </Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive" className="flex-1">
              <Trash2 /> Delete
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this bot?</DialogTitle>
              <DialogDescription>
                This removes the bot and all its knowledge documents. This
                can't be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button variant="destructive" disabled={remove.isPending} onClick={doDelete}>
                {remove.isPending ? "Deleting…" : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
