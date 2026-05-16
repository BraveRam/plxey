// Telegram BusinessBotRights — see https://core.telegram.org/bots/api#businessbotrights
// We keep our own permissive type rather than depending on grammy's, so the
// JSON we persist in the `rights` column round-trips cleanly.
export interface BusinessBotRights {
  can_reply?: boolean;
  can_read_messages?: boolean;
  can_delete_sent_messages?: boolean;
  can_delete_all_messages?: boolean;
  can_edit_name?: boolean;
  can_edit_bio?: boolean;
  can_edit_profile_photo?: boolean;
  can_edit_username?: boolean;
  can_change_gift_settings?: boolean;
  can_view_gifts_and_stars?: boolean;
  can_convert_gifts_to_stars?: boolean;
  can_transfer_and_upgrade_gifts?: boolean;
  can_transfer_stars?: boolean;
  can_manage_stories?: boolean;
  [key: string]: boolean | undefined;
}

interface PermissionEntry {
  key: keyof BusinessBotRights;
  label: string;
  required: boolean;
}

// "required" here means "the bot is useless without it" — currently only
// can_reply, since the entire customer-support flow depends on the bot
// being able to send messages on the owner's behalf.
const PERMISSION_ROWS: PermissionEntry[] = [
  { key: "can_reply", label: "Reply to messages", required: true },
  { key: "can_read_messages", label: "Read messages", required: false },
  { key: "can_delete_sent_messages", label: "Delete its own messages", required: false },
  { key: "can_delete_all_messages", label: "Delete any message", required: false },
  { key: "can_edit_name", label: "Edit your name", required: false },
  { key: "can_edit_bio", label: "Edit your bio", required: false },
  { key: "can_edit_profile_photo", label: "Edit your profile photo", required: false },
  { key: "can_edit_username", label: "Edit your username", required: false },
  { key: "can_manage_stories", label: "Manage stories", required: false },
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
      "Open Telegram → Settings → Business → Chatbots, add this bot, " +
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
