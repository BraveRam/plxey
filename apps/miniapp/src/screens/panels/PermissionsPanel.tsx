import { CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/api";

// Human labels for the Telegram business-bot rights flags.
const RIGHT_LABELS: Record<string, string> = {
  can_reply: "Reply to customers",
  can_read_messages: "Read messages",
  can_delete_sent_messages: "Delete its own messages",
  can_delete_all_messages: "Delete any message",
  can_edit_name: "Edit account name",
  can_edit_bio: "Edit bio",
  can_edit_profile_photo: "Edit profile photo",
  can_edit_username: "Edit username",
  can_change_gift_settings: "Change gift settings",
  can_view_gifts_and_stars: "View gifts & stars",
  can_convert_gifts_to_stars: "Convert gifts to stars",
  can_transfer_and_upgrade_gifts: "Transfer & upgrade gifts",
  can_transfer_stars: "Transfer stars",
  can_manage_stories: "Manage stories",
};

function Row({ label, granted }: { label: string; granted: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm">{label}</span>
      {granted ? (
        <CheckCircle2 className="size-5 text-emerald-500" />
      ) : (
        <XCircle className="size-5 text-muted-foreground/50" />
      )}
    </div>
  );
}

export function PermissionsPanel({ botId }: { botId: string }) {
  const { data, isLoading } = usePermissions(botId);

  if (isLoading || !data) {
    return <Skeleton className="h-40 w-full" />;
  }

  if (!data.connected) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        This bot isn't connected to a business account yet. Add it under
        Telegram → Settings → Business → Chatbots.
      </Card>
    );
  }

  const rights = data.rights ?? {};
  const entries = Object.keys(RIGHT_LABELS).filter((k) => k in rights);

  return (
    <div className="space-y-4">
      {!data.isEnabled ? (
        <Card className="p-4 text-sm text-amber-600 dark:text-amber-400">
          The business connection is currently disabled.
        </Card>
      ) : null}
      <Card>
        <CardContent className="divide-y pt-2">
          {entries.length > 0 ? (
            entries.map((key) => (
              <Row
                key={key}
                label={RIGHT_LABELS[key] ?? key}
                granted={Boolean(rights[key])}
              />
            ))
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No permission details available.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
