// Telegram BusinessBotRights — see https://core.telegram.org/bots/api#businessbotrights
// We keep our own permissive type rather than depending on grammy's, so the
// JSON we persist in the `rights` column round-trips cleanly. The full
// payload is stored in DB; we only surface the rights that affect this
// bot's actual functionality.
export interface BusinessBotRights {
  can_reply?: boolean;
  can_read_messages?: boolean;
  [key: string]: boolean | undefined;
}

interface PermissionEntry {
  key: keyof BusinessBotRights;
  label: string;
  required: boolean;
}

// Only show what the bot actually uses. Other Telegram-business rights
// (delete-message, edit-profile, gift management, manage-stories, ...) are
// real but irrelevant here — surfacing them just confuses owners about
// what they need to grant for support to work.
const PERMISSION_ROWS: PermissionEntry[] = [
  { key: "can_reply", label: "Reply to messages", required: true },
  { key: "can_read_messages", label: "Read messages", required: false },
];

export function canReply(rights: BusinessBotRights | null | undefined): boolean {
  return Boolean(rights?.can_reply);
}

export function canReadMessages(rights: BusinessBotRights | null | undefined): boolean {
  return Boolean(rights?.can_read_messages);
}

export function formatPermissions(rights: BusinessBotRights | null): string {
  if (!rights) {
    return (
      "No business connection yet.\n\n" +
      "Open Telegram → Settings → Profile → Chat Automation, add this bot, " +
      "and grant 'Reply to messages' (required) plus 'Read messages' " +
      "(recommended)."
    );
  }
  return PERMISSION_ROWS
    .map(({ key, label, required }) => {
      const granted = Boolean(rights[key]);
      const icon = granted ? "✅" : required ? "⚠️" : "❌";
      return `${icon} ${label}`;
    })
    .join("\n");
}
