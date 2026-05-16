import type { Api, Context } from "grammy";
import type { Message } from "grammy/types";

/**
 * Forward whatever the owner sent (text/photo/voice/video/sticker/…) to the
 * customer chat via the given business connection, so the customer sees
 * the message as if it came from the business owner directly.
 *
 * Why not `copyMessage`? Telegram's `copyMessage` does NOT accept
 * `business_connection_id` (confirmed against @grammyjs/types@3.26.0 and
 * the Bot API changelog). Without it, the copy lands as the bot, not the
 * owner. So we dispatch by message type to the matching `sendXxx` method,
 * each of which *does* support `business_connection_id`, and reuse the
 * incoming media's `file_id` so we never re-upload bytes.
 *
 * Returns `true` if the message was forwarded, `false` if it's a kind we
 * don't handle (service messages, polls, paid-media, etc.). Throws on
 * Telegram API errors so the caller can surface a useful failure.
 */
export async function forwardMessageAsBusinessReply(
  api: Api,
  msg: Message,
  toChatId: number,
  businessConnectionId: string,
): Promise<boolean> {
  const conn = { business_connection_id: businessConnectionId };

  if (typeof msg.text === "string") {
    await api.sendMessage(toChatId, msg.text, {
      ...conn,
      entities: msg.entities,
    });
    return true;
  }

  if (msg.photo && msg.photo.length > 0) {
    // photo is an array of progressively larger sizes; the last entry is
    // the full-resolution original, which is what we want to forward.
    const largest = msg.photo[msg.photo.length - 1]!;
    await api.sendPhoto(toChatId, largest.file_id, {
      ...conn,
      caption: msg.caption,
      caption_entities: msg.caption_entities,
    });
    return true;
  }

  if (msg.voice) {
    await api.sendVoice(toChatId, msg.voice.file_id, {
      ...conn,
      caption: msg.caption,
      caption_entities: msg.caption_entities,
    });
    return true;
  }

  if (msg.audio) {
    await api.sendAudio(toChatId, msg.audio.file_id, {
      ...conn,
      caption: msg.caption,
      caption_entities: msg.caption_entities,
    });
    return true;
  }

  if (msg.video) {
    await api.sendVideo(toChatId, msg.video.file_id, {
      ...conn,
      caption: msg.caption,
      caption_entities: msg.caption_entities,
    });
    return true;
  }

  if (msg.video_note) {
    await api.sendVideoNote(toChatId, msg.video_note.file_id, conn);
    return true;
  }

  // animation (GIF) must be checked before document — Telegram includes a
  // document field on animation messages too.
  if (msg.animation) {
    await api.sendAnimation(toChatId, msg.animation.file_id, {
      ...conn,
      caption: msg.caption,
      caption_entities: msg.caption_entities,
    });
    return true;
  }

  if (msg.document) {
    await api.sendDocument(toChatId, msg.document.file_id, {
      ...conn,
      caption: msg.caption,
      caption_entities: msg.caption_entities,
    });
    return true;
  }

  if (msg.sticker) {
    await api.sendSticker(toChatId, msg.sticker.file_id, conn);
    return true;
  }

  if (msg.location) {
    await api.sendLocation(
      toChatId,
      msg.location.latitude,
      msg.location.longitude,
      conn,
    );
    return true;
  }

  if (msg.contact) {
    await api.sendContact(
      toChatId,
      msg.contact.phone_number,
      msg.contact.first_name,
      {
        ...conn,
        last_name: msg.contact.last_name,
        vcard: msg.contact.vcard,
      },
    );
    return true;
  }

  return false;
}
